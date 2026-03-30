// Maps Firebase Auth error codes to user-friendly messages
export default function friendlyAuthMessage(err) {
  if (!err) return 'Authentication failed. Please try again.'
  const code = err.code || err?.response?.data?.error || ''
  switch (code) {
    case 'auth/user-not-found':
      return 'Account not found. Please check your email or sign up for a new account.'
    case 'auth/wrong-password':
      return 'Incorrect password. Please try again or reset your password.'
    case 'auth/invalid-email':
      return 'That email address looks invalid. Please check and try again.'
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in instead.'
    case 'auth/weak-password':
      return 'Password is too weak. Please choose a stronger password (at least 6 characters).'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.'
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.'
    case 'auth/requires-recent-login':
      return 'For security reasons, please sign in again to perform this action.'
    case 'auth/operation-not-allowed':
      return 'This authentication method is currently disabled. Please contact support.'
    case 'auth/no_mx_record':
    case 'auth/no-mx-record':
      return 'The email domain entered seems to be invalid. Please use a different email address.'
    default:
      // Fallback: sometimes Firebase returns human-readable messages in err.message
      if (err.message && typeof err.message === 'string') {
        // Normalize a few common message fragments
        if (err.message.toLowerCase().includes('invalid email')) return 'That email address looks invalid. Please check and try again.'
        if (err.message.toLowerCase().includes('password')) return 'There was a problem with the password provided. Please check and try again.'
      }
      return 'Authentication failed. Please check your details and try again.'
  }
}
