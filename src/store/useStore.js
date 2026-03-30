import { create } from 'zustand'
import { applyAdjustmentsBase64 } from '../utils/adjustments'
import { applyFilter } from '../services/api'

export const useStore = create((set, get) => ({
  // Image state
  currentImage: null,
  originalImage: null,
  // Keep raw original base64 for reference
  originalImageBase64: null,
  // The image that subsequent operations should apply to
  baseImage: null,
  // History stacks for undo/redo
  history: [], // each entry: { image, adjustments, layers, drawingStrokes }
  future: [],

  // Layers state
  layers: [], // { id, name, type: 'filter'|'adjustment'|'adjustments'|'base', visible, config }
  activeLayerId: null,
  mask: null,
  // Crop state
  aspectLock: false,
  cropRect: null, // { x, y, w, h }
  cropPresetRatio: null,
  
  // Tool state
  activeTool: null, // 'magic-wand','image-eraser','image-restorer','pen','pen-eraser','lasso','box','crop'
  penMode: 'draw', // 'draw' | 'erase'
  bgEraserSize: 24,
  bgRestorerSize: 24,
  bgRestorerFeather: 0,
  penDropper: false,
  penColor: '#ff0000',
  penSize: 4,
  drawingStrokes: [], // each { id, color, size, points: [ {x,y} ] }
  lassoPath: [], // freehand selection points
  activeSelection: null, // { type:'lasso', points:[{x,y}]} | { type:'box', box:{x,y,w,h} }
  activeSelections: [], // multiple selections when shift-add is used
  
  // Adjustments
  adjustments: {
    brightness: 0,
    contrast: 0,
    exposure: 0,
    saturation: 0,
    temperature: 0,
    tint: 0,
    highlights: 0,
    shadows: 0,
    vignette: 0,
    sharpness: 0,
  },
  
  // Active filter preset
  activeFilter: null,
  
  // Selection state
  hasSelection: false,
  selectionPoints: [],
  // Staged removal (temporary) used by selection tools before the user explicitly saves
  stagedRemoval: null, // { id, dataUrl, prevImage }
  hasStagedRemoval: false,
  // IDs of manual removal masks that have been saved/locked and should not be modified
  lockedManualRemovalIds: [],
  // Track which parent tool opened the restorer (so MaskTools can behave accordingly)
  restorerParent: null, // 'remove-bg' | 'image-eraser' | 'lasso' | 'box' | 'magic-wand' | null
  
  // Loading state
  isProcessing: false,
  // UI page state: 'editor' | 'projects' | 'login'
  activePage: 'editor',
  setActivePage: (p) => {
    // Directly set active page; removing navigation confirmation modal to streamline navigation.
    set({ activePage: p })
  },
  // current editable title for the open edit
  currentTitle: 'Untitled',
  setCurrentTitle: (t) => set({ currentTitle: t }),
  // flag to indicate a save should occur automatically after auth completes
  pendingSaveAfterAuth: false,
  setPendingSaveAfterAuth: (v) => set({ pendingSaveAfterAuth: v }),
  // Create a fresh empty project (clears image, layers, history)
  createEmptyProject: () => set(() => {
    const initialAdjustments = {
      brightness: 0,
      contrast: 0,
      exposure: 0,
      saturation: 0,
      temperature: 0,
      tint: 0,
      highlights: 0,
      shadows: 0,
      vignette: 0,
      sharpness: 0,
    }
    return {
      currentImage: null,
      originalImage: null,
      originalImageBase64: null,
      baseImage: null,
      history: [],
      future: [],
      layers: [],
      activeLayerId: null,
      drawingStrokes: [],
      manualRemovalMasks: [],
      adjustments: initialAdjustments,
      currentTitle: 'Untitled',
    }
  }),
  
  
  // Actions
  // push a history snapshot including manual removal masks
  pushHistorySnapshot: () => set((state) => ({ history: [...state.history, { image: state.currentImage, adjustments: JSON.parse(JSON.stringify(state.adjustments)), layers: JSON.parse(JSON.stringify(state.layers || [])), drawingStrokes: JSON.parse(JSON.stringify(state.drawingStrokes || [])), manualRemovalMasks: JSON.parse(JSON.stringify(state.manualRemovalMasks || [])) }], future: [] })),

  addLayer: (type, name = null, config = {}) => set((state) => {
    const id = Date.now()
    const layer = { id, name: name || `${type} ${new Date().toLocaleTimeString()}`, type, visible: true, config }
    return { layers: [...state.layers, layer], activeLayerId: id }
  }),
  // Session flags to group tool usage
  _penSessionActive: false,
  startPenSession: () => set({ _penSessionActive: true }),
  endPenSession: () => set((state) => ({ _penSessionActive: false })),
  setCurrentImage: (image) => set({ currentImage: image }),
  setRestorerParent: (p) => set({ restorerParent: p }),
  // Initialize a new editing session with an image
  initImage: (image) => set(() => {
    const bgId = Date.now()
    const initialAdjustments = {
      brightness: 0,
      contrast: 0,
      exposure: 0,
      saturation: 0,
      temperature: 0,
      tint: 0,
      highlights: 0,
      shadows: 0,
      vignette: 0,
      sharpness: 0,
    }
    // Create a hidden original layer (index 0) and a visible background/base layer (index 1)
    const origId = bgId - 1
    const originalLayer = { id: origId, name: 'Original', type: 'original', visible: false, config: { image } }
    const backgroundLayer = { id: bgId, name: 'Background', type: 'base', visible: true, config: { image } }
    return {
      originalImage: image,
      originalImageBase64: image,
      baseImage: image,
      currentImage: image,
      history: [{ image, adjustments: initialAdjustments, layers: [originalLayer, backgroundLayer], drawingStrokes: [], manualRemovalMasks: [] }],
      future: [],
      layers: [originalLayer, backgroundLayer],
      activeLayerId: bgId,
      adjustments: initialAdjustments,
    }
  }),
  // Apply a new image result; if commit=true, also push to history and set as base
  setImage: (image, commit = false) => set((state) => {
    const next = { currentImage: image }
    if (commit) {
      return {
        ...next,
        baseImage: image,
        history: [...state.history, { image, adjustments: JSON.parse(JSON.stringify(state.adjustments)), layers: JSON.parse(JSON.stringify(state.layers || [])), drawingStrokes: JSON.parse(JSON.stringify(state.drawingStrokes || [])), manualRemovalMasks: JSON.parse(JSON.stringify(state.manualRemovalMasks || [])) }],
        future: [],
      }
    }
    return next
  }),
  commitCurrentImage: () => set((state) => {
    if (!state.currentImage) return {}
    // Avoid duplicate consecutive entries
    const last = state.history[state.history.length - 1]
    const currentLayers = JSON.parse(JSON.stringify(state.layers || []))
    const currentAdjustments = JSON.parse(JSON.stringify(state.adjustments || {}))
    // If last exists and the image bytes match, but layers or adjustments changed,
    // we still want to record a new history entry so undo reverts only the logical change.
    if (last && last.image === state.currentImage) {
      const lastLayers = JSON.stringify(last.layers || [])
      const lastAdjust = JSON.stringify(last.adjustments || {})
      if (lastLayers === JSON.stringify(currentLayers) && lastAdjust === JSON.stringify(currentAdjustments)) {
        return { baseImage: state.currentImage }
      }
      // otherwise fallthrough to push a new entry
    }
    return {
      baseImage: state.currentImage,
      history: [...state.history, { image: state.currentImage, adjustments: currentAdjustments, layers: currentLayers, drawingStrokes: JSON.parse(JSON.stringify(state.drawingStrokes || [])), manualRemovalMasks: JSON.parse(JSON.stringify(state.manualRemovalMasks || [])) }],
      future: [],
    }
  }),
  undo: () => set((state) => {
    if (state.history.length <= 1) return {}
    const prevEntry = state.history[state.history.length - 2]
    const currentEntry = state.history[state.history.length - 1]
    return {
      history: state.history.slice(0, -1),
      future: [currentEntry, ...state.future],
      baseImage: prevEntry.image,
      currentImage: prevEntry.image,
      adjustments: { ...prevEntry.adjustments },
      layers: prevEntry.layers,
      drawingStrokes: prevEntry.drawingStrokes || [],
      manualRemovalMasks: prevEntry.manualRemovalMasks || [],
    }
  }),
  redo: () => {
    // perform state update synchronously
    set((state) => {
      if (state.future.length === 0) return {}
      const nextEntry = state.future[0]
      return {
        history: [...state.history, nextEntry],
        future: state.future.slice(1),
        baseImage: nextEntry.image,
        currentImage: nextEntry.image,
        adjustments: { ...nextEntry.adjustments },
        layers: nextEntry.layers,
        drawingStrokes: nextEntry.drawingStrokes || [],
        manualRemovalMasks: nextEntry.manualRemovalMasks || [],
      }
    })
    // After updating state, ensure the composite reflects layer/adjustment state.
    // This covers cases where the stored `image` snapshot may not include
    // adjustments applied as separate layer configs.
    try { if (typeof get().recomputeComposite === 'function') get().recomputeComposite() } catch (e) {}
  },
  setMask: (mask) => set({ mask }),
  setActiveTool: (tool) => set((state) => {
    // if there's a staged removal and the user switches away from selection tools,
    // discard the staged removal (revert currentImage)
    const selectionToolIds = ['lasso', 'box', 'magic-wand']
    // Allow switching to 'remove-bg' without discarding a staged removal so the
    // UI can present the Save option after auto-remove. Other non-selection
    // tools should still discard staged removals when switching.
    if (state.hasStagedRemoval && !selectionToolIds.includes(tool) && tool !== 'image-restorer' && tool !== 'remove-bg') {
      // revert current image to pre-staged image and clear staged state
      const prev = state.stagedRemoval?.prevImage || state.baseImage || state.currentImage
      return { currentImage: prev, stagedRemoval: null, hasStagedRemoval: false, activeTool: tool, activeSelection: null, activeSelections: [], lassoPath: [], selectionPoints: [] }
    }

    // clicking the active tool toggles it off; switching tools clears selections/lasso/crop preview
    if (state.activeTool === tool) {
      // debug log to trace tool toggles
      try { console.debug('[store] toggle active tool off', tool) } catch (e) {}
      // If there is a staged removal and user toggles the tool off without saving, discard it
      if (state.hasStagedRemoval) {
        const prev = state.stagedRemoval?.prevImage || state.baseImage || state.currentImage
        // clear staged removal and revert image
        if (tool === 'pen') return { activeTool: null, cropRect: null, activeSelection: null, activeSelections: [], lassoPath: [], selectionPoints: [], hasSelection: false, drawingStrokes: [], _penSessionActive: false, stagedRemoval: null, hasStagedRemoval: false, currentImage: prev }
        return { activeTool: null, cropRect: null, activeSelection: null, activeSelections: [], lassoPath: [], selectionPoints: [], hasSelection: false, stagedRemoval: null, hasStagedRemoval: false, currentImage: prev }
      }
      // If toggling off pen, clear unsaved strokes
      if (tool === 'pen') return { activeTool: null, cropRect: null, activeSelection: null, activeSelections: [], lassoPath: [], selectionPoints: [], hasSelection: false, drawingStrokes: [], _penSessionActive: false }
      return { activeTool: null, cropRect: null, activeSelection: null, activeSelections: [], lassoPath: [], selectionPoints: [], hasSelection: false }
    }

    // When switching to a non-crop tool, clear any existing cropRect to avoid lingering UI
    // If we're switching into the image-restorer and the restorer was opened from a selection tool,
    // preserve the active selection state so multiple restore strokes can be applied.
    const selectionParents = ['lasso', 'box', 'magic-wand']
    const isRestorerFromSelection = tool === 'image-restorer' && selectionParents.includes(state.restorerParent)
    const next = isRestorerFromSelection ? { activeTool: tool } : { activeTool: tool, activeSelection: null }
    if (tool !== 'crop') next.cropRect = null
    // switching away from selection tools should clear multi-selections unless we're entering restorer from a selection
    if (!(tool === 'lasso' || tool === 'box' || isRestorerFromSelection)) {
      next.activeSelections = []
      next.lassoPath = []
    }
    // switching away from pen should clear unsaved strokes
    if (tool !== 'pen') {
      next.drawingStrokes = []
      next._penSessionActive = false
    }
    try { console.debug('[store] setActiveTool ->', tool, next) } catch (e) {}
    return next
  }),
  addToActiveSelections: (sel) => set((state) => ({ activeSelections: [...(state.activeSelections || []), sel] })),
  clearActiveSelections: () => set({ activeSelections: [] }),
  // Stage a removal without committing it. This updates `currentImage` visually
  // but does not add to `manualRemovalMasks` or history until `saveStagedRemoval`
  stageRemoval: (maskEntry, resultImage) => set((state) => {
    // If there's already a staged removal, we should combine the new mask into the existing
    // stagedRemoval.dataUrl so multiple strokes are part of the same staged change. Also,
    // preserve the original prevImage from the first staged call so discarding reverts all unsaved strokes.
    if (state.hasStagedRemoval && state.stagedRemoval && state.stagedRemoval.dataUrl) {
      // Preserve the original prevImage from the first staged removal so discarding will revert all unsaved strokes.
      const preservedPrev = state.stagedRemoval.prevImage
      // Optimistically set stagedRemoval to include the newest maskDataUrl (so preview remains correct)
      setTimeout(async () => {
        try {
          const existing = state.stagedRemoval.dataUrl
          const newMask = maskEntry.dataUrl
          if (existing && newMask) {
            const eImg = new Image(); eImg.src = existing
            const nImg = new Image(); nImg.src = newMask
            await Promise.all([new Promise(r=>{eImg.onload=r;eImg.onerror=r}), new Promise(r=>{nImg.onload=r;nImg.onerror=r})])
            const W = eImg.width || nImg.width
            const H = eImg.height || nImg.height
            const c = document.createElement('canvas')
            c.width = W; c.height = H
            const cx = c.getContext('2d')
            cx.clearRect(0,0,W,H)
            cx.drawImage(eImg,0,0,W,H)
            cx.drawImage(nImg,0,0,W,H)
            const combined = c.toDataURL('image/png')
            useStore.setState((s)=>({ stagedRemoval: { ...(s.stagedRemoval||{}), dataUrl: combined, prevImage: preservedPrev } }))
          }
        } catch (e) {
          // ignore combine failures
        }
      }, 0)
      return { stagedRemoval: { ...maskEntry, prevImage: preservedPrev }, currentImage: resultImage, hasStagedRemoval: true, activeSelection: null, activeSelections: [], lassoPath: [], selectionPoints: [] }
    }
    return { stagedRemoval: { ...maskEntry, prevImage: state.currentImage }, currentImage: resultImage, hasStagedRemoval: true, activeSelection: null, activeSelections: [], lassoPath: [], selectionPoints: [] }
  }),
  // Commit staged removal: move staged mask into manualRemovalMasks, add a hidden selection layer and snapshot history
  saveStagedRemoval: () => set((state) => {
    if (!state.stagedRemoval) return {}
    const mask = { id: state.stagedRemoval.id, dataUrl: state.stagedRemoval.dataUrl }
    const next = { manualRemovalMasks: [...(state.manualRemovalMasks || []), mask], stagedRemoval: null, hasStagedRemoval: false, lockedManualRemovalIds: [...(state.lockedManualRemovalIds || []), mask.id] }
    // Commit current image into history so this becomes permanent
    setTimeout(async () => {
      try {
        // Bake the current preview (which includes the staged removal) into the first base layer
        // IMPORTANT: The `currentImage` already contains any applied filters. To avoid
        // re-applying filter layers on top of an already-filtered image (which causes
        // the visual duplication the user reported), we flatten/bake the composite into
        // the base image and remove existing filter layers. This preserves the visual
        // result while preventing filters from being applied twice.
        const cur = get().currentImage
        if (cur) {
          const layers = get().layers || []
          // Update the first base layer image and remove filter layers since their
          // effect has been baked into `cur`.
          const newLayers = layers
            .map(l => l.type === 'base' ? { ...l, config: { ...l.config, image: cur } } : l)
            .filter(l => l.type !== 'filter')
          useStore.setState({ layers: newLayers })
        }
      } catch (e) {
        console.warn('Failed to bake staged removal into base layer', e)
      }
      try { if (typeof get().recomputeComposite === 'function') await get().recomputeComposite() } catch (e) {}
      try { if (typeof get().commitCurrentImage === 'function') get().commitCurrentImage() } catch (e) {}
      try { if (typeof get().addLayer === 'function') get().addLayer('selection', 'Remove') } catch (e) {}
      try { if (typeof get().pushHistorySnapshot === 'function') get().pushHistorySnapshot() } catch (e) {}
    }, 0)
    return next
  }, false),
  // Discard staged removal and revert the previewed image
  discardStagedRemoval: () => set((state) => {
    if (!state.stagedRemoval) return {}
    const prev = state.stagedRemoval.prevImage || state.baseImage || state.currentImage
    return { currentImage: prev, stagedRemoval: null, hasStagedRemoval: false }
  }),
  setPenColor: (color) => set({ penColor: color }),
  setPenSize: (size) => set({ penSize: size }),
  setPenMode: (mode) => set({ penMode: mode }),
  setBgEraserSize: (size) => set({ bgEraserSize: size }),
  setBgRestorerSize: (size) => set({ bgRestorerSize: size }),
  setBgRestorerFeather: (f) => set({ bgRestorerFeather: f }),
  setPenDropper: (on) => set({ penDropper: on }),
  // x,y are in image-space coordinates. Optional size and color override per-stroke.
  addStrokePoint: (x, y, size = null, color = null) => set((state) => {
    if (state.activeTool !== 'pen') return {}
    if (!state._penSessionActive) state.startPenSession()
    const strokes = [...state.drawingStrokes]
    const useColor = color || state.penColor
    const useSize = size != null ? size : state.penSize
    if (strokes.length === 0 || strokes[strokes.length - 1].finalized) {
      // start new stroke
      strokes.push({ id: Date.now(), color: useColor, size: useSize, points: [{ x, y }], finalized: false })
    } else {
      strokes[strokes.length - 1].points.push({ x, y })
    }
    return { drawingStrokes: strokes }
  }),
  finalizeStroke: () => set((state) => {
    const strokes = [...state.drawingStrokes]
    if (strokes.length && !strokes[strokes.length - 1].finalized) {
      strokes[strokes.length - 1].finalized = true
    }
    // push to history so undo/redo can revert this stroke addition
    const entry = { image: state.currentImage, adjustments: JSON.parse(JSON.stringify(state.adjustments)), layers: JSON.parse(JSON.stringify(state.layers || [])), drawingStrokes: JSON.parse(JSON.stringify(strokes || [])), manualRemovalMasks: JSON.parse(JSON.stringify(state.manualRemovalMasks || [])) }
    return { drawingStrokes: strokes, history: [...state.history, entry], future: [] }
  }),

  // Commit current pen strokes into the image and create a non-editable pen layer
  savePenStrokes: async () => {
    const state = get()
    if (!state.currentImage || !state.drawingStrokes || state.drawingStrokes.length === 0) return
    // Create a transparent pen layer containing only the rasterized strokes
    // Determine canvas size from the current base image (preferred) or currentImage
    const sizeRef = new Image()
    sizeRef.src = state.baseImage || state.currentImage
    await new Promise((res) => { sizeRef.onload = res })
    const W = sizeRef.width, H = sizeRef.height
    const off = document.createElement('canvas')
    off.width = W; off.height = H
    const ctx = off.getContext('2d')
    // ensure a transparent background (do NOT draw the base/current image)
    ctx.clearRect(0, 0, W, H)
    // draw strokes in image space (strokes stored in image coordinates)
    state.drawingStrokes.forEach(stroke => {
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.size
      ctx.beginPath()
      stroke.points.forEach((p,i)=>{ if(i===0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y) })
      ctx.stroke()
    })
    const dataUrl = off.toDataURL('image/png')
    // Add a pen layer with the rasterized strokes (do not modify baseImage)
    const layer = { id: Date.now(), name: 'Pen', type: 'pen', visible: true, config: { image: dataUrl } }
    // Add the pen layer and clear live strokes (do not push history yet)
    set((s) => ({
      drawingStrokes: [],
      layers: [...s.layers, layer],
      activeLayerId: layer.id,
    }))
    // Recompute composite so the new pen layer appears in currentImage
    await get().recomputeComposite()
    // After composite updated, push a proper history snapshot that captures the composite image and layers
    if (typeof get().pushHistorySnapshot === 'function') get().pushHistorySnapshot()
    // end pen session
    set({ _penSessionActive: false })
  },

  // Cancel current pen strokes (discard unsaved strokes)
  cancelPenStrokes: () => set((state) => ({ drawingStrokes: [], _penSessionActive: false })),
  eraseStrokeAt: (x, y) => set((state) => {
    // Allow erasing when dedicated eraser tool is active or when pen tool is in erase mode
    const isErasing = state.activeTool === 'pen-eraser' || (state.activeTool === 'pen' && state.penMode === 'erase')
    if (!isErasing) return {}
    // drawingStrokes store points in image-space and stroke.size is in image-space
    const strokes = state.drawingStrokes.filter(stroke => {
      const r2 = (stroke.size * 2) ** 2
      return !stroke.points.some(p => (p.x - x) ** 2 + (p.y - y) ** 2 < r2)
    })
    const entry = { image: state.currentImage, adjustments: JSON.parse(JSON.stringify(state.adjustments)), layers: JSON.parse(JSON.stringify(state.layers || [])), drawingStrokes: JSON.parse(JSON.stringify(strokes || [])), manualRemovalMasks: JSON.parse(JSON.stringify(state.manualRemovalMasks || [])) }
    return { drawingStrokes: strokes, history: [...state.history, entry], future: [] }
  }),
  clearStrokes: () => set({ drawingStrokes: [] }),
  addLassoPoint: (x, y) => set((state) => state.activeTool === 'lasso' ? { lassoPath: [...state.lassoPath, { x, y }] } : {}),
  resetLasso: () => set({ lassoPath: [] }),
  setActiveSelection: (sel) => set({ activeSelection: sel }),
  clearActiveSelection: () => set({ activeSelection: null }),
  removeSelection: (inverse = false) => {
    const state = get()
    const sels = []
    if (state.activeSelection) sels.push(state.activeSelection)
    if (state.activeSelections && state.activeSelections.length) sels.push(...state.activeSelections)
    if (sels.length === 0 || !state.currentImage) return
    const img = new Image()
    img.src = state.currentImage
    img.onload = () => {
      const W = img.width, H = img.height
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)

      // mask canvas captures exactly the pixels removed (opaque where removed)
      const mask = document.createElement('canvas')
      mask.width = W
      mask.height = H
      const mctx = mask.getContext('2d')
      mctx.fillStyle = '#000'

      if (!inverse) {
        // Remove inside each selection: clear each shape and mark it on the mask
        for (const sel of sels) {
          if (sel.type === 'lasso' && sel.points && sel.points.length > 2) {
            ctx.save()
            ctx.beginPath()
            sel.points.forEach((pt,i)=>{ if(i===0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y) })
            ctx.closePath()
            ctx.clip()
            ctx.clearRect(0,0,W,H)
            ctx.restore()
            mctx.beginPath()
            sel.points.forEach((pt,i)=>{ if(i===0) mctx.moveTo(pt.x, pt.y); else mctx.lineTo(pt.x, pt.y) })
            mctx.closePath()
            mctx.fill()
          } else if (sel.type === 'box' && sel.box) {
            const { x, y, w, h } = sel.box
            ctx.clearRect(x, y, w, h)
            mctx.fillRect(x, y, w, h)
          }
        }
      } else {
        // Inverse: remove outside the UNION of all selections -> keep union
        const union = document.createElement('canvas')
        union.width = W
        union.height = H
        const uctx = union.getContext('2d')
        uctx.fillStyle = '#000'
        for (const sel of sels) {
          if (sel.type === 'lasso' && sel.points && sel.points.length > 2) {
            uctx.beginPath()
            sel.points.forEach((pt,i)=>{ if(i===0) uctx.moveTo(pt.x, pt.y); else uctx.lineTo(pt.x, pt.y) })
            uctx.closePath()
            uctx.fill()
          } else if (sel.type === 'box' && sel.box) {
            const { x, y, w, h } = sel.box
            uctx.fillRect(x, y, w, h)
          }
        }
        // Keep only union area on the image (remove outside union)
        ctx.globalCompositeOperation = 'destination-in'
        ctx.drawImage(union, 0, 0)
        ctx.globalCompositeOperation = 'source-over'
        // mask: removed area is outside union -> fill then punch out union
        mctx.save()
        mctx.fillRect(0,0,W,H)
        mctx.globalCompositeOperation = 'destination-out'
        mctx.drawImage(union, 0, 0)
        mctx.restore()
      }

      const result = canvas.toDataURL('image/png')
      const maskData = mask.toDataURL('image/png')
      const maskEntry = { id: Date.now(), dataUrl: maskData }
      // Stage removal (do not commit); this updates currentImage visually but can be discarded
      get().stageRemoval(maskEntry, result)
    }
  },
  inverseSelection: () => get().removeSelection(true),
  applyLassoRemoval: (removeInside = true) => {
    const state = get()
    if (!state.currentImage || state.lassoPath.length < 3) return
    const img = new Image()
    img.src = state.currentImage
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      // Create path
      ctx.save()
      ctx.beginPath()
      state.lassoPath.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y)
        else ctx.lineTo(pt.x, pt.y)
      })
      ctx.closePath()
      ctx.clip()
      // If removing inside: clear inside; else clear outside
      if (removeInside) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      } else {
        // Outside removal: need inverse mask
        ctx.restore()
        const full = ctx.getImageData(0,0,canvas.width,canvas.height)
        const maskCanvas = document.createElement('canvas')
        maskCanvas.width = canvas.width
        maskCanvas.height = canvas.height
        const mctx = maskCanvas.getContext('2d')
        mctx.drawImage(img,0,0)
        mctx.save()
        mctx.beginPath()
        state.lassoPath.forEach((pt,i)=>{ if(i===0) mctx.moveTo(pt.x,pt.y); else mctx.lineTo(pt.x,pt.y) })
        mctx.closePath()
        mctx.globalCompositeOperation = 'destination-in'
        mctx.fill()
        // Clear outside by combining alpha
        ctx.clearRect(0,0,canvas.width,canvas.height)
        ctx.drawImage(maskCanvas,0,0)
      }
      ctx.restore()
      const result = canvas.toDataURL('image/png')
      set({ currentImage: result })
      get().commitCurrentImage()
      set({ lassoPath: [] })
    }
  },
  setAdjustments: (adjustments) => set({ adjustments }),
  updateAdjustment: (key, value) => set((state) => ({
    adjustments: { ...state.adjustments, [key]: value }
  })),
  setActiveFilter: (filter) => set({ activeFilter: filter }),
  setHasSelection: (hasSelection) => set({ hasSelection }),
  addSelectionPoint: (point) => set((state) => ({
    selectionPoints: [...state.selectionPoints, point]
  })),
  clearSelection: () => set({ selectionPoints: [], hasSelection: false }),
  setIsProcessing: (isProcessing) => set({ isProcessing }),
  setAspectLock: (lock) => set({ aspectLock: lock }),
  setCropRect: (rect) => set({ cropRect: rect }),
  setCropPresetRatio: (ratio) => set({ cropPresetRatio: ratio }),
  // Toast notifications
  toast: null,
  showToast: (msg) => set({ toast: msg }),
  hideToast: () => set({ toast: null }),
  // Auth redirect message shown on the login page when redirected from a guarded action
  authMessage: null,
  setAuthMessage: (msg) => set({ authMessage: msg }),
  resetAdjustments: () => set({
    adjustments: {
      brightness: 0,
      contrast: 0,
      exposure: 0,
      saturation: 0,
      temperature: 0,
      tint: 0,
      highlights: 0,
      shadows: 0,
      vignette: 0,
      sharpness: 0,
    }
  }),

  // Layer actions (filters)
  // Recompute composite image
  recomputeComposite: async () => {
    const state = get()
    // Prefer the first 'base' layer's configured image as the compositing source.
    const baseLayer = (state.layers || []).find(l => l.type === 'base' && l.config && l.config.image)
    const source = baseLayer?.config?.image || state.baseImage || state.originalImageBase64
    if (!source) return
    let working = source
    // Apply layers in order, respecting visibility and sequence
    for (const layer of state.layers) {
      if (!layer.visible) continue
      if (layer.type === 'adjustment') {
        const k = layer.config?.kind
        const v = layer.config?.value ?? 0
        if (k && typeof v === 'number' && v !== 0) {
          const adj = {
            brightness: 0,
            contrast: 0,
            exposure: 0,
            saturation: 0,
            temperature: 0,
            tint: 0,
            highlights: 0,
            shadows: 0,
            vignette: 0,
            sharpness: 0,
          }
          adj[k] = v
          working = await applyAdjustmentsBase64(working, adj)
        }
      } else if (layer.type === 'adjustments') {
        const conf = layer.config || {}
        if (Object.values(conf).some(val => typeof val === 'number' && val !== 0)) {
          working = await applyAdjustmentsBase64(working, conf)
        }
      }
      // Filters are handled after this loop using progressive application
    }
    // Progressive filter application with cache invalidation based on input hash
    const updatedLayers = state.layers.map(l => ({ ...l }))
    for (let i = 0; i < updatedLayers.length; i++) {
      const layer = updatedLayers[i]
      if (!layer.visible || layer.type !== 'filter') continue
      const { preset, amount = 100, cachedResult, inputHash } = layer.config || {}
      if (!preset) continue
      const currentInputHash = (working || '').slice(0, 128) // simple hash surrogate
      let filteredImage = cachedResult
      if (!cachedResult || inputHash !== currentInputHash) {
        try {
          const result = await applyFilter(working, preset)
          filteredImage = result.result
          layer.config.cachedResult = filteredImage
          layer.config.inputHash = currentInputHash
        } catch (e) {
          // Fallback: if filter API fails, skip applying this filter
          console.error('Filter apply failed', e)
          filteredImage = working
        }
      }
      const alpha = Math.max(0, Math.min(1, amount / 100))
      if (alpha >= 1) {
        working = filteredImage
      } else if (alpha > 0) {
        // Simple alpha blend using canvas (reuse blendBase64 from adjustments)
        const { blendBase64 } = await import('../utils/adjustments')
        working = await blendBase64(working, filteredImage, alpha)
      }
    }
    // After adjustments/filters, composite any pen-type layers (drawn images) in order
    const penLayers = updatedLayers.filter(l => l.visible && l.type === 'pen')
    if (penLayers.length) {
      try {
        const baseImg = new Image()
        baseImg.src = working
        await new Promise((res) => { baseImg.onload = res })
        const W = baseImg.width, H = baseImg.height
        const off = document.createElement('canvas')
        off.width = W; off.height = H
        const ctx = off.getContext('2d')
        ctx.drawImage(baseImg, 0, 0)
        for (const pl of penLayers) {
          if (!pl.config || !pl.config.image) continue
          const img = new Image()
          img.src = pl.config.image
          // eslint-disable-next-line no-await-in-loop
          await new Promise((res) => { img.onload = res })
          ctx.drawImage(img, 0, 0)
        }
        working = off.toDataURL('image/png')
      } catch (e) {
        console.error('Pen layer composite failed', e)
      }
    }
    set({ currentImage: working, layers: updatedLayers })
  },
  createFilterLayer: (preset) => {
    const id = Date.now()
    const newLayer = { id, name: `${preset}`, type: 'filter', visible: true, config: { preset, amount: 100, cachedResult: null } }
    set((state) => ({ layers: [...(state.layers || []), newLayer], activeLayerId: id }))
    return id
  },
  createAdjustmentLayer: (kind) => set((state) => {
    const id = Date.now()
    const name = kind.charAt(0).toUpperCase() + kind.slice(1)
    const newLayer = { id, name, type: 'adjustment', visible: true, config: { kind, value: 0 } }
    return { layers: [...state.layers, newLayer], activeLayerId: id }
  }, false),
  // Selecting a layer should sync adjustments UI if it's an adjustments layer
  setActiveLayer: (id) => set((state) => {
    const layer = state.layers.find(l => l.id === id)
    const next = { activeLayerId: id }
    if (layer) {
      // Support both single-kind 'adjustment' layers and multi-value 'adjustments' layers
      if (layer.type === 'adjustments') {
        next.adjustments = { ...layer.config }
      } else if (layer.type === 'adjustment') {
        // sync the specific adjustment into top-level adjustments for the UI
        const adjKey = layer.config?.kind
        const adjVal = layer.config?.value ?? 0
        next.adjustments = { ...(state.adjustments || {}), [adjKey]: adjVal }
      }
    }
    return next
  }),
  setLayerVisibility: (id, visible) => {
    set((state) => ({ layers: state.layers.map(l => l.id === id ? { ...l, visible } : l) }))
    get().recomputeComposite()
  },
  setLayerFilterPreset: (id, preset) => {
    set((state) => ({
      layers: state.layers.map(l => l.id === id ? { ...l, config: { ...l.config, preset, cachedResult: null } } : l)
    }))
  },
  setLayerFilterAmount: (id, amount) => {
    set((state) => ({ layers: state.layers.map(l => l.id === id ? { ...l, config: { ...l.config, amount } } : l) }))
    get().recomputeComposite()
  },
  setLayerFilterCachedResult: (id, dataUrl) => {
    set((state) => ({ layers: state.layers.map(l => l.id === id ? { ...l, config: { ...l.config, cachedResult: dataUrl } } : l) }))
    get().recomputeComposite()
  },
  removeLayer: (id) => {
    // Simple remove: drop layer and recompute composite so pen layers are removed independently
    set((state) => ({
      layers: state.layers.filter(l => l.id !== id),
      activeLayerId: state.activeLayerId === id ? null : state.activeLayerId,
    }))
    get().recomputeComposite()
  },
  reorderLayers: (sourceIndex, destIndex) => {
    set((state) => {
      if (sourceIndex === destIndex) return {}
      const layers = [...state.layers]
      const [moved] = layers.splice(sourceIndex, 1)
      layers.splice(destIndex, 0, moved)
      return { layers }
    })
    get().recomputeComposite()
  },

  // Adjustments layers
  setAdjustmentLayerValue: (id, value) => {
    set((state) => ({ layers: state.layers.map(l => l.id === id ? { ...l, config: { ...l.config, value } } : l) }))
    get().recomputeComposite()
  },

  // Override updateAdjustment to also reflect into active adjustments layer if selected
  updateAdjustment: (key, value) => {
    // legacy multi adjustments path
    set((state) => ({ adjustments: { ...state.adjustments, [key]: value } }))
    get().recomputeComposite()
  },

  // Apply crop: update the first background layer's image, recompute composite, and push history snapshot
  applyCrop: async (dataUrl) => {
    const state = get()
    const rect = state.cropRect
    // If we don't have a crop rect, just replace base image as before
    if (!rect) {
      set((s) => ({ layers: (s.layers || []).map(l => l.type === 'base' ? { ...l, config: { ...l.config, image: dataUrl } } : l) }))
      await get().recomputeComposite()
      if (typeof get().pushHistorySnapshot === 'function') get().pushHistorySnapshot()
      set({ cropRect: null })
      return
    }

    // Crop rectangle is present and should be applied to base and to any raster layers (pen layers)
    try {
      const W = rect.w, H = rect.h, sx = rect.x, sy = rect.y
      const layers = state.layers || []
      // Process layers: crop pen images to the new rect and invalidate filter cached results
      const processed = await Promise.all(layers.map(async (l) => {
        if (l.type === 'base') {
          return { ...l, config: { ...l.config, image: dataUrl } }
        }
        if (l.type === 'pen' && l.config && l.config.image) {
          try {
            const limg = new Image()
            limg.src = l.config.image
            await new Promise((res) => { limg.onload = res; limg.onerror = res })
            const pc = document.createElement('canvas')
            pc.width = W; pc.height = H
            const pctx = pc.getContext('2d')
            // draw the relevant source rect from the pen image into the cropped canvas
            pctx.clearRect(0,0,W,H)
            pctx.drawImage(limg, sx, sy, W, H, 0, 0, W, H)
            return { ...l, config: { ...l.config, image: pc.toDataURL('image/png') } }
          } catch (e) {
            console.warn('Failed to crop pen layer', e)
            return l
          }
        }
        // For filters, cachedResult may be based on previous image size; invalidate cache
        if (l.type === 'filter' && l.config) {
          return { ...l, config: { ...l.config, cachedResult: null, inputHash: null } }
        }
        // For adjustments or other types that don't carry raster images, leave as-is
        return l
      }))

      // Commit processed layers, recompute composite, then push history snapshot
      // NOTE: Do NOT overwrite `originalImageBase64` here — it should remain the true
      // original image so the Reset action can restore it. Only update the editable
      // layers (including the base layer) to reflect the crop.
      set({ layers: processed })
      await get().recomputeComposite()
      if (typeof get().pushHistorySnapshot === 'function') get().pushHistorySnapshot()
    } catch (e) {
      console.warn('applyCrop: failed to crop layers', e)
      // fallback: set base image directly (do NOT overwrite `originalImageBase64`)
      set((s) => ({ layers: (s.layers || []).map(l => l.type === 'base' ? { ...l, config: { ...l.config, image: dataUrl } } : l) }))
      await get().recomputeComposite()
      if (typeof get().pushHistorySnapshot === 'function') get().pushHistorySnapshot()
    }
    // Clear crop preview
    set({ cropRect: null })
  },
}))

// Warn user on page refresh/close if there are unsaved edits in memory
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    try {
      const s = useStore.getState()
      // Only prompt when there are real unsaved edits.
      // Conditions to prompt:
      // - a current image exists (editor not empty)
      // - history has more than one snapshot
      // - the first and last history images differ (indicating edits were made)
      if (s && s.currentImage && Array.isArray(s.history) && s.history.length > 1) {
        try {
          const first = s.history[0] && s.history[0].image
          const last = s.history[s.history.length - 1] && s.history[s.history.length - 1].image
          if (first && last && first !== last) {
            e.preventDefault()
            e.returnValue = ''
          }
        } catch (inner) {
          // Fallback to conservative behavior: prompt if history length > 1 and currentImage exists
          e.preventDefault()
          e.returnValue = ''
        }
      }
    } catch (err) {}
  })
}
