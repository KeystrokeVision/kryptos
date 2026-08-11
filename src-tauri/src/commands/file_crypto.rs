use std::path::Path;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::Argon2;
use rand::RngCore;
use serde::Serialize;

const MAGIC: &[u8; 4] = b"KRY1";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

fn derive_key(password: &str, salt: &[u8; SALT_LEN]) -> Result<[u8; 32], String> {
    let mut key = [0u8; 32];
    Argon2::default().hash_password_into(password.as_bytes(), salt, &mut key).map_err(|e| format!("No se pudo derivar la clave: {e}"))?;
    Ok(key)
}

#[derive(Serialize)]
pub struct CryptoResult {
    pub output_path: String,
}

/// Encrypts a file with a password: AES-256-GCM, key derived via Argon2id
/// with a fresh random salt per file. Output: `KRY1` magic + 16-byte salt +
/// 12-byte nonce + ciphertext. Writes to `<original>.kryptos` unless an
/// output path is given.
#[tauri::command]
pub fn encrypt_file(path: String, password: String, output_path: Option<String>) -> Result<CryptoResult, String> {
    if password.is_empty() {
        return Err("La contrasena no puede estar vacia.".into());
    }
    let data = std::fs::read(&path).map_err(|e| format!("No se pudo leer '{path}': {e}"))?;

    let mut salt = [0u8; SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    let key_bytes = derive_key(&password, &salt)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));

    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, data.as_slice()).map_err(|e| format!("No se pudo cifrar: {e}"))?;

    let mut out = Vec::with_capacity(4 + SALT_LEN + NONCE_LEN + ciphertext.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);

    let out_path = output_path.unwrap_or_else(|| format!("{path}.kryptos"));
    std::fs::write(&out_path, out).map_err(|e| format!("No se pudo escribir '{out_path}': {e}"))?;
    Ok(CryptoResult { output_path: out_path })
}

/// Decrypts a file produced by `encrypt_file`. A wrong password fails
/// cleanly (AES-GCM's authentication tag won't verify) — never produces
/// garbage output silently.
#[tauri::command]
pub fn decrypt_file(path: String, password: String, output_path: Option<String>) -> Result<CryptoResult, String> {
    let data = std::fs::read(&path).map_err(|e| format!("No se pudo leer '{path}': {e}"))?;
    if data.len() < 4 + SALT_LEN + NONCE_LEN || &data[0..4] != MAGIC {
        return Err("Este archivo no parece haber sido cifrado con KRYPTOS (falta la cabecera esperada).".into());
    }

    let salt: [u8; SALT_LEN] = data[4..4 + SALT_LEN].try_into().unwrap();
    let nonce_bytes: [u8; NONCE_LEN] = data[4 + SALT_LEN..4 + SALT_LEN + NONCE_LEN].try_into().unwrap();
    let ciphertext = &data[4 + SALT_LEN + NONCE_LEN..];

    let key_bytes = derive_key(&password, &salt)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher.decrypt(nonce, ciphertext).map_err(|_| "Contrasena incorrecta, o el archivo esta corrupto.".to_string())?;

    let out_path = output_path.unwrap_or_else(|| {
        let p = Path::new(&path);
        if p.extension().and_then(|e| e.to_str()) == Some("kryptos") {
            p.with_extension("").display().to_string()
        } else {
            format!("{path}.decrypted")
        }
    });
    std::fs::write(&out_path, plaintext).map_err(|e| format!("No se pudo escribir '{out_path}': {e}"))?;
    Ok(CryptoResult { output_path: out_path })
}
