#[tauri::command]
fn lire_fichier(chemin: String) -> String {
    std::fs::read_to_string(chemin).unwrap_or_default()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![lire_fichier])
        .run(tauri::generate_context!())
        .expect("erreur");
}
