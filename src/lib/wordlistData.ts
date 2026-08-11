// Wordlist base + reglas de mutacion, al estilo de las reglas de hashcat:
// en vez de guardar un archivo gigante de millones de contrasenas filtradas
// (que ademas no se puede redistribuir de forma responsable), se parte de
// una lista curada de palabras/contrasenas realmente comunes y se le
// aplican variaciones tipicas (mayuscula inicial, sufijos numericos, anos,
// simbolos) — el mismo patron que cualquier wordlist + regla de John the
// Ripper o hashcat, pensado para practicar contra un hash que VOS mismo
// pusiste (un CTF, o una contrasena propia que olvidaste), nunca contra
// credenciales ajenas.

export const BASE_WORDLIST: string[] = [
  "123456", "password", "12345678", "qwerty", "123456789", "12345", "1234", "111111", "1234567", "dragon",
  "123123", "baseball", "abc123", "football", "monkey", "letmein", "696969", "shadow", "master", "666666",
  "qwertyuiop", "123321", "mustang", "1234567890", "michael", "654321", "superman", "1qaz2wsx", "7777777",
  "121212", "000000", "qazwsx", "123qwe", "killer", "trustno1", "jennifer", "hunter", "buster", "soccer",
  "harley", "batman", "andrew", "tigger", "sunshine", "iloveyou", "2000", "charlie", "robert", "thomas",
  "hockey", "ranger", "daniel", "starwars", "klaster", "112233", "george", "computer", "michelle", "jessica",
  "pepper", "1111", "zxcvbn", "555555", "11111111", "131313", "freedom", "777777", "pass", "admin", "welcome",
  "contrasena", "login", "princess", "qwerty123", "solo", "passw0rd", "whatever", "hello", "1q2w3e4r", "zaq1zaq1",
  "qwe123", "asdfgh", "asdf1234", "1qazxsw2", "q1w2e3r4", "aa123456", "flower", "hottie", "loveme", "biteme",
  "yankees", "lakers", "chelsea", "arsenal", "liverpool", "internet", "server", "network", "system", "linux",
  "windows", "ubuntu", "python", "java", "coding", "hacker", "ninja", "wizard", "dragonball", "pokemon",
  "minecraft", "fortnite", "roblox", "steam", "discord", "spotify", "netflix", "google", "facebook", "twitter",
  "instagram", "whatsapp", "telegram", "amazon", "apple", "samsung", "toyota", "honda", "nissan", "ferrari",
  "diamond", "silver", "golden", "phoenix", "dragonfire", "shadowfax", "darkstar", "redsox", "cowboys", "eagles",
  "panthers", "raiders", "packers", "broncos", "chicago", "newyork", "london", "madrid", "barcelona", "berlin",
  "paris", "tokyo", "mexico", "brasil", "argentina", "colombia", "espana", "america", "canada", "australia",
];

// Reglas: cada una toma una palabra base y devuelve una variante — el mismo
// concepto que un archivo .rule de hashcat, simplificado a funciones puras.
const YEARS = ["2020", "2021", "2022", "2023", "2024", "2025"];
const SUFFIXES = ["1", "12", "123", "1234", "01", "007", "69", "!", "!!", "#1"];

export function* generateCandidates(extraWords: string[] = []): Generator<string> {
  const words = [...BASE_WORDLIST, ...extraWords.map((w) => w.trim()).filter(Boolean)];
  for (const word of words) {
    yield word;
    yield word.toLowerCase();
    yield word.toUpperCase();
    yield word.charAt(0).toUpperCase() + word.slice(1);
    for (const suffix of SUFFIXES) {
      yield `${word}${suffix}`;
      yield `${word.charAt(0).toUpperCase() + word.slice(1)}${suffix}`;
    }
    for (const year of YEARS) {
      yield `${word}${year}`;
    }
  }
}

export function estimateCandidateCount(extraWordsCount: number): number {
  const words = BASE_WORDLIST.length + extraWordsCount;
  return words * (4 + SUFFIXES.length * 2 + YEARS.length);
}
