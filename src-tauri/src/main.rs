// Sin consola detras de la ventana en Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tribuna_pos_lib::ejecutar();
}
