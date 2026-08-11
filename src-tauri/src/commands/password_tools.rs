use rand::seq::SliceRandom;
use serde::Serialize;
use std::time::Duration;

const LOWER: &str = "abcdefghijklmnopqrstuvwxyz";
const UPPER: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &str = "0123456789";
const SYMBOLS: &str = "!@#$%^&*()-_=+[]{};:,.<>?";

/// Generates a password using the OS's cryptographically secure RNG
/// (`rand::thread_rng`, backed by the system entropy source) — never a
/// predictable PRNG. Runs entirely locally; nothing is transmitted
/// anywhere.
#[tauri::command]
pub fn generate_password(length: u32, use_upper: bool, use_digits: bool, use_symbols: bool) -> Result<String, String> {
    let length = length.clamp(4, 128) as usize;

    let mut pool = String::from(LOWER);
    if use_upper {
        pool.push_str(UPPER);
    }
    if use_digits {
        pool.push_str(DIGITS);
    }
    if use_symbols {
        pool.push_str(SYMBOLS);
    }

    let chars: Vec<char> = pool.chars().collect();
    let mut rng = rand::thread_rng();
    let mut password: Vec<char> = (0..length)
        .map(|_| *chars.choose(&mut rng).expect("character pool is never empty"))
        .collect();
    password.shuffle(&mut rng);
    Ok(password.into_iter().collect())
}

#[derive(Serialize)]
pub struct PasswordStrength {
    pub score: u8, // 0-4, matches the common zxcvbn-style scale
    pub label: String,
    pub entropy_bits: f64,
    pub feedback: Vec<String>,
}

const COMMON_PASSWORDS: &[&str] = &[
    "123456", "password", "12345678", "qwerty", "123456789", "12345", "1234", "111111", "1234567", "dragon",
    "123123", "baseball", "abc123", "football", "monkey", "letmein", "696969", "shadow", "master", "666666",
    "qwertyuiop", "123321", "mustang", "1234567890", "michael", "654321", "superman", "1qaz2wsx", "7777777",
    "121212", "000000", "qazwsx", "123qwe", "killer", "trustno1", "jennifer", "hunter", "buster", "soccer",
    "harley", "batman", "andrew", "tigger", "sunshine", "iloveyou", "fuckyou", "2000", "charlie", "robert",
    "thomas", "hockey", "ranger", "daniel", "starwars", "klaster", "112233", "george", "asshole", "computer",
    "michelle", "jessica", "pepper", "1111", "zxcvbn", "555555", "11111111", "131313", "freedom", "777777",
    "pass", "admin", "welcome", "contraseña", "contrasena",
];

/// Estimates password strength offline from character-class diversity and
/// length (rough Shannon-entropy heuristic), plus a check against known
/// extremely common passwords. This intentionally never contacts a
/// network service — a real strength checker that phones home defeats the
/// point of a password tool.
#[tauri::command]
pub fn check_password_strength(password: String) -> PasswordStrength {
    let mut feedback = Vec::new();

    if COMMON_PASSWORDS.contains(&password.to_lowercase().as_str()) {
        return PasswordStrength {
            score: 0,
            label: "Muy debil".into(),
            entropy_bits: 0.0,
            feedback: vec!["Esta entre las contrasenas mas usadas del mundo — evitala por completo.".into()],
        };
    }

    let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
    let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    let has_symbol = password.chars().any(|c| !c.is_alphanumeric());

    let mut pool_size = 0u32;
    if has_lower {
        pool_size += 26;
    }
    if has_upper {
        pool_size += 26;
    }
    if has_digit {
        pool_size += 10;
    }
    if has_symbol {
        pool_size += 33;
    }
    if pool_size == 0 {
        pool_size = 1;
    }

    let length = password.chars().count() as f64;
    let entropy_bits = length * (pool_size as f64).log2();

    if length < 8.0 {
        feedback.push("Muy corta: usa al menos 12 caracteres.".into());
    }
    if !has_upper {
        feedback.push("Agrega mayusculas.".into());
    }
    if !has_digit {
        feedback.push("Agrega numeros.".into());
    }
    if !has_symbol {
        feedback.push("Agrega simbolos.".into());
    }

    let unique_chars = password.chars().collect::<std::collections::HashSet<_>>().len();
    if length > 0.0 && (unique_chars as f64 / length) < 0.5 {
        feedback.push("Tiene muchos caracteres repetidos, eso reduce la entropia real.".into());
    }

    let (score, label) = match entropy_bits {
        b if b < 28.0 => (0, "Muy debil"),
        b if b < 36.0 => (1, "Debil"),
        b if b < 60.0 => (2, "Aceptable"),
        b if b < 80.0 => (3, "Fuerte"),
        _ => (4, "Muy fuerte"),
    };

    if feedback.is_empty() {
        feedback.push("Buena combinacion de longitud y variedad de caracteres.".into());
    }

    PasswordStrength { score, label: label.to_string(), entropy_bits, feedback }
}

// ---------------------------------------------------------------------
// Have I Been Pwned, via k-anonimato — a diferencia de lo anterior, esto
// SI contacta un servicio externo, asi que es un comando aparte que el
// frontend solo llama cuando el usuario presiona un boton explicito, nunca
// automaticamente. El frontend calcula el SHA-1 de la contrasena y manda
// solo los primeros 5 caracteres del hash: HIBP responde con todos los
// sufijos que empiezan igual, y la comparacion final (¿aparece mi sufijo
// completo?) se hace en el frontend. La contrasena en si nunca sale de
// este equipo, ni siquiera hasheada completa.
// ---------------------------------------------------------------------

/// Devuelve el rango de sufijos de HIBP para un prefijo de hash SHA-1 de 5
/// caracteres. `prefix` debe venir ya calculado por el frontend.
#[tauri::command]
pub fn check_pwned_range(prefix: String) -> Result<String, String> {
    let prefix = prefix.trim().to_uppercase();
    if prefix.len() != 5 || !prefix.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("El prefijo debe ser de 5 caracteres hexadecimales.".into());
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("KRYPTOS-password-tools/0.1")
        .build()
        .map_err(|e| format!("No se pudo preparar el cliente HTTP: {e}"))?;

    let url = format!("https://api.pwnedpasswords.com/range/{prefix}");
    let response = client.get(&url).send().map_err(|e| format!("No se pudo consultar Have I Been Pwned: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Have I Been Pwned respondio con error {}.", response.status()));
    }
    response.text().map_err(|e| format!("No se pudo leer la respuesta: {e}"))
}
