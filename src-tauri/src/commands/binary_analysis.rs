//! Analizador estatico de binarios PE (Windows) y ELF (Linux) — cabeceras,
//! secciones, tabla de importaciones, y entropia. El punto de partida
//! clasico de cualquier ingenieria inversa: "que es este .exe, que trae
//! adentro, esta empaquetado". Solo lee bytes del archivo, nunca lo ejecuta.

use std::collections::BTreeMap;
use std::fs;

use goblin::elf::header as elf_header;
use goblin::Object;
use serde::Serialize;

#[derive(Serialize)]
pub struct SectionInfo {
    pub name: String,
    pub virtual_size: u64,
    pub raw_size: u64,
    pub entropy: f64,
    pub flags: Vec<String>,
}

#[derive(Serialize)]
pub struct ImportGroup {
    pub library: String,
    pub functions: Vec<String>,
    pub truncated: bool,
}

#[derive(Serialize)]
pub struct BinaryAnalysis {
    pub format: String,
    pub architecture: String,
    pub is_64_bit: bool,
    pub is_library: bool,
    pub entry_point: Option<String>,
    pub timestamp_unix: Option<i64>,
    pub file_entropy: f64,
    pub sections: Vec<SectionInfo>,
    pub imports: Vec<ImportGroup>,
    pub warnings: Vec<String>,
}

// 128MB alcanza de sobra para casi cualquier ejecutable o libreria real, y
// evita que un archivo gigante elegido por error deje a KRYPTOS leyendolo
// entero a memoria por un analisis puntual.
const MAX_FILE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_FUNCTIONS_PER_LIB: usize = 25;

fn shannon_entropy(data: &[u8]) -> f64 {
    if data.is_empty() {
        return 0.0;
    }
    let mut counts = [0u64; 256];
    for &b in data {
        counts[b as usize] += 1;
    }
    let len = data.len() as f64;
    counts
        .iter()
        .filter(|&&c| c > 0)
        .map(|&c| {
            let p = c as f64 / len;
            -p * p.log2()
        })
        .sum()
}

fn section_bytes<'a>(bytes: &'a [u8], offset: usize, size: usize) -> &'a [u8] {
    if offset >= bytes.len() {
        return &[];
    }
    let end = (offset + size).min(bytes.len());
    &bytes[offset..end]
}

fn pe_machine_name(machine: u16) -> String {
    match machine {
        0x8664 => "x86_64".into(),
        0x14c => "x86 (32 bits)".into(),
        0xaa64 => "ARM64".into(),
        0x1c0 => "ARM".into(),
        other => format!("desconocido (0x{other:x})"),
    }
}

fn pe_section_flags(characteristics: u32) -> Vec<String> {
    let mut flags = Vec::new();
    if characteristics & 0x2000_0000 != 0 {
        flags.push("EXECUTE".to_string());
    }
    if characteristics & 0x4000_0000 != 0 {
        flags.push("READ".to_string());
    }
    if characteristics & 0x8000_0000 != 0 {
        flags.push("WRITE".to_string());
    }
    if flags.is_empty() {
        flags.push("—".to_string());
    }
    flags
}

fn analyze_pe(pe: &goblin::pe::PE, bytes: &[u8], file_entropy: f64) -> BinaryAnalysis {
    let mut sections = Vec::new();
    let mut any_high_entropy_section = false;

    for section in &pe.sections {
        let name = section.name().unwrap_or("?").trim_end_matches('\0').to_string();
        let raw_size = section.size_of_raw_data as u64;
        let data = section_bytes(bytes, section.pointer_to_raw_data as usize, section.size_of_raw_data as usize);
        let entropy = shannon_entropy(data);
        if entropy > 7.5 && !data.is_empty() {
            any_high_entropy_section = true;
        }
        sections.push(SectionInfo {
            name,
            virtual_size: section.virtual_size as u64,
            raw_size,
            entropy,
            flags: pe_section_flags(section.characteristics),
        });
    }

    let mut grouped: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for import in &pe.imports {
        grouped.entry(import.dll.to_string()).or_default().push(import.name.to_string());
    }
    let imports = grouped
        .into_iter()
        .map(|(library, mut functions)| {
            functions.sort();
            let truncated = functions.len() > MAX_FUNCTIONS_PER_LIB;
            functions.truncate(MAX_FUNCTIONS_PER_LIB);
            ImportGroup { library, functions, truncated }
        })
        .collect::<Vec<_>>();

    let mut warnings = Vec::new();
    if file_entropy > 7.5 {
        warnings.push("Entropia global alta (>7.5 de 8) — indicio comun de compresion, empaquetado o cifrado.".to_string());
    }
    if any_high_entropy_section {
        warnings.push("Al menos una seccion tiene entropia muy alta — revisala, es el patron tipico de un packer.".to_string());
    }
    if imports.is_empty() {
        warnings.push("No se encontro tabla de importaciones legible — comun en binarios empaquetados u ofuscados.".to_string());
    }

    BinaryAnalysis {
        format: "PE (Windows)".to_string(),
        architecture: pe_machine_name(pe.header.coff_header.machine),
        is_64_bit: pe.is_64,
        is_library: pe.is_lib,
        entry_point: Some(format!("0x{:x} (RVA)", pe.entry)),
        timestamp_unix: Some(pe.header.coff_header.time_date_stamp as i64),
        file_entropy,
        sections,
        imports,
        warnings,
    }
}

fn elf_machine_name(machine: u16) -> String {
    match machine {
        elf_header::EM_X86_64 => "x86_64".into(),
        elf_header::EM_386 => "x86 (32 bits)".into(),
        elf_header::EM_AARCH64 => "ARM64".into(),
        elf_header::EM_ARM => "ARM".into(),
        other => format!("desconocido ({other})"),
    }
}

fn elf_section_flags(flags: u64) -> Vec<String> {
    let mut out = Vec::new();
    if flags & 0x4 != 0 {
        out.push("EXECUTE".to_string()); // SHF_EXECINSTR
    }
    if flags & 0x2 != 0 {
        out.push("ALLOC".to_string()); // SHF_ALLOC
    }
    if flags & 0x1 != 0 {
        out.push("WRITE".to_string()); // SHF_WRITE
    }
    if out.is_empty() {
        out.push("—".to_string());
    }
    out
}

fn analyze_elf(elf: &goblin::elf::Elf, bytes: &[u8], file_entropy: f64) -> BinaryAnalysis {
    let mut sections = Vec::new();
    let mut any_high_entropy_section = false;

    for sh in &elf.section_headers {
        let name = elf.shdr_strtab.get_at(sh.sh_name).unwrap_or("?").to_string();
        if name.is_empty() {
            continue;
        }
        let data = section_bytes(bytes, sh.sh_offset as usize, sh.sh_size as usize);
        let entropy = shannon_entropy(data);
        if entropy > 7.5 && !data.is_empty() {
            any_high_entropy_section = true;
        }
        sections.push(SectionInfo {
            name,
            virtual_size: sh.sh_size,
            raw_size: sh.sh_size,
            entropy,
            flags: elf_section_flags(sh.sh_flags),
        });
    }

    // ELF no tiene una "tabla de imports" con funciones agrupadas por
    // libreria como PE — lo que hay es la lista de librerias compartidas
    // que el binario declara necesitar (DT_NEEDED), que es la informacion
    // equivalente mas util de mostrar de un vistazo.
    let imports = if elf.libraries.is_empty() {
        Vec::new()
    } else {
        vec![ImportGroup {
            library: "Librerias compartidas requeridas (DT_NEEDED)".to_string(),
            functions: elf.libraries.iter().map(|s| s.to_string()).collect(),
            truncated: false,
        }]
    };

    let mut warnings = Vec::new();
    if file_entropy > 7.5 {
        warnings.push("Entropia global alta (>7.5 de 8) — indicio comun de compresion, empaquetado o cifrado.".to_string());
    }
    if any_high_entropy_section {
        warnings.push("Al menos una seccion tiene entropia muy alta — revisala, es el patron tipico de un packer.".to_string());
    }

    BinaryAnalysis {
        format: "ELF (Linux)".to_string(),
        architecture: elf_machine_name(elf.header.e_machine),
        is_64_bit: elf.is_64,
        is_library: elf.header.e_type == elf_header::ET_DYN,
        entry_point: Some(format!("0x{:x}", elf.entry)),
        timestamp_unix: None,
        file_entropy,
        sections,
        imports,
        warnings,
    }
}

/// Lee un archivo y, si es un ejecutable/libreria PE o ELF reconocible,
/// devuelve su radiografia: arquitectura, secciones con su entropia
/// individual, y que librerias/funciones importa. Solo lectura — nunca
/// ejecuta el archivo analizado.
#[tauri::command]
pub fn analyze_binary(path: String) -> Result<BinaryAnalysis, String> {
    let metadata = fs::metadata(&path).map_err(|e| format!("No se pudo leer el archivo: {e}"))?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(format!(
            "El archivo pesa {} MB — por ahora el analisis esta limitado a 128MB.",
            metadata.len() / 1024 / 1024
        ));
    }

    let bytes = fs::read(&path).map_err(|e| format!("No se pudo leer el archivo: {e}"))?;
    let file_entropy = shannon_entropy(&bytes);

    match Object::parse(&bytes).map_err(|e| format!("No se pudo interpretar el archivo: {e}"))? {
        Object::PE(pe) => Ok(analyze_pe(&pe, &bytes, file_entropy)),
        Object::Elf(elf) => Ok(analyze_elf(&elf, &bytes, file_entropy)),
        Object::Mach(_) => Err("Los binarios Mach-O (macOS) todavia no estan soportados por este analizador.".into()),
        Object::Archive(_) => Err("Esto es un archivo de biblioteca estatica (.a/.lib), no un ejecutable — este analizador lee PE y ELF.".into()),
        _ => Err("No se reconoce el formato del archivo como PE ni ELF.".into()),
    }
}
