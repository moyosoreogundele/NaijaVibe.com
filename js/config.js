/* Public browser configuration. Resend credentials belong in the server-side .env file, never here. */
window.NV_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  AGORA_APP_ID: '844bd870a1a84bbd8797044aaffc11e7',        // public Agora App ID; never put the App Certificate here
  AGORA_TOKEN_FUNCTION: 'agora-token',
  STORAGE_BUCKET: 'uploads',
  APP_NAME: 'NaijaVibe'
};
/* Content categories. Mirrors data/*.json */
window.NV_CATEGORIES = [{"slug": "food", "name": "Food & Drinks", "icon": "utensils"}, {"slug": "travel", "name": "Travel & Places", "icon": "plane"}, {"slug": "culture", "name": "Culture & Heritage", "icon": "masks"}, {"slug": "music", "name": "Music & Entertainment", "icon": "music"}, {"slug": "fashion", "name": "Fashion & Style", "icon": "shirt"}, {"slug": "events", "name": "Events", "icon": "calendar"}, {"slug": "marketplace", "name": "Marketplace", "icon": "store"}, {"slug": "businesses", "name": "Businesses", "icon": "briefcase"}];
window.NV_DEMO = { trending: [], popular: [], events: [], businesses: [], products: [], posts: [], notifications: [] };
