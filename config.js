// Supabase connection (same project as PPL Coach and Nutrition Coach).
// The publishable key and the notification public key are safe to publish: row-level security limits
// every signed-in user to their own rows. Never put the service_role / secret key or VAPID private key here.
window.UP_CONFIG = {
  supabaseUrl: 'https://mwlzmpyiendhvebkatfi.supabase.co',
  supabaseAnonKey: 'sb_publishable_6-Z4ivZdsmcOgtw3LyhXeg_IpiIpggI',
  vapidPublicKey: 'BNL5EkpVlGrqNGYVT0UCb-Hl5ds_pwzeBxMPiqe5-TJIVvsC59CIMWZT8-VRBgr_PoGUSnU7F93f0ig_pbxKUo0'
};
