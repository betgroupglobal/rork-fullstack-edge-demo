// ── Sensitive-field detection and value masking ──

/** Sensitive-field patterns for masking in the UI — Set for O(1) lookup. */
const _SENSITIVE_FIELDS_ARR = [
  "password", "passwd", "pass", "pwd", "passcode", "passphrase",
  "new_password", "old_password", "current_password", "confirm_password",
  "newpassword", "oldpassword", "currentpassword", "confirmpassword",
  "secret", "api_key", "apikey", "api_secret", "apisecret",
  "client_secret", "app_secret", "private_key", "privatekey",
  "signing_key", "encryption_key", "webhook_secret",
  "token", "access_token", "refresh_token", "id_token", "auth_token",
  "bearer", "authorization", "x-auth-token", "x-api-key",
  "oauth_token", "oauth_token_secret", "oauth_verifier",
  "code", "auth_code", "authorization_code",
  "session", "session_id", "sessionid", "session_token",
  "cookie", "csrf", "csrf_token", "xsrf", "xsrf_token",
  "_token", "__token", "authenticity_token",
  "jwt", "id_token", "nonce",
  "otp", "totp", "hotp", "mfa_code", "mfa_token", "two_factor",
  "twofactor", "2fa", "verification_code", "verificationcode",
  "sms_code", "smscode", "backup_code", "recovery_code",
  "card", "card_number", "cardnumber", "pan",
  "cvv", "cvc", "cvv2", "csc",
  "pin", "card_pin", "atm_pin",
  "expiry", "expiration", "exp_date", "expdate",
  "ssn", "social_security", "tax_id", "ein",
  "iban", "bsb", "routing_number", "account_number",
  "bank_account", "sort_code",
  "mnemonic", "seed_phrase", "private_key", "keystore",
  "wallet_password", "wallet_key",
];

/** Credential/identity field patterns shown prominently in the intercept UI. */
const _CREDENTIAL_FIELDS_ARR = [
  "username", "user_name", "user", "uname", "login_name", "loginname",
  "handle", "screen_name", "screenname", "display_name", "displayname",
  "nick", "nickname", "alias",
  "email", "email_address", "emailaddress", "mail", "e_mail", "e-mail",
  "login_email", "account_email", "contact_email",
  "phone", "phone_number", "phonenumber", "mobile", "mobile_number",
  "msisdn", "cell", "cellphone", "telephone", "tel",
  "login", "loginid", "login_id",
  "account", "account_id", "accountid", "account_name", "accountname",
  "member", "member_id", "memberid", "membership_id", "membershipid",
  "customer", "customer_id", "customerid", "client", "client_id", "clientid",
  "player", "player_id", "playerid",
  "userid", "user_id", "uid",
  "subscriber", "subscriber_id",
  "identity", "identity_number", "national_id",
  "password", "passwd", "pass", "pwd", "passcode", "passphrase",
  "new_password", "old_password", "confirm_password",
  "otp", "totp", "mfa_code", "two_factor", "2fa",
  "verification_code", "sms_code", "backup_code",
  "code", "auth_code", "authorization_code", "oauth_token",
  "id_token", "access_token",
  "card_number", "pan", "cvv", "cvc", "pin",
  "expiry", "expiration", "iban", "account_number",
  "wallet", "wallet_address", "address", "mnemonic",
];

export const SENSITIVE_FIELDS: ReadonlySet<string> = new Set(_SENSITIVE_FIELDS_ARR);
export const CREDENTIAL_FIELDS: ReadonlySet<string> = new Set(_CREDENTIAL_FIELDS_ARR);

/** Mask a value by showing first 2 and last 2 characters. */
export function maskValue(value: string): string {
  if (!value || value.length <= 6) return "***";
  return `${value.slice(0, 2)}${"*".repeat(Math.min(value.length - 4, 12))}${value.slice(-2)}`;
}
