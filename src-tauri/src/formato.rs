//! Como se escribe el dinero cuando el nucleo redacta un texto.
//!
//! Casi siempre el dinero sale hacia la pantalla como entero y la
//! interfaz lo formatea. Pero la auditoria guarda frases ya armadas —«el
//! arriendo paso de X a Y»— y esas se escriben aqui: sin esto quedaban
//! como «por 640000», que es un numero de base de datos, no una cifra.

/// Pesos colombianos con punto de miles y sin decimales: `$640.000`.
pub fn pesos(valor: i64) -> String {
    let negativo = valor < 0;
    let digitos = valor.unsigned_abs().to_string();

    let mut con_puntos = String::with_capacity(digitos.len() + digitos.len() / 3 + 2);
    for (puestos, c) in digitos.chars().rev().enumerate() {
        if puestos > 0 && puestos % 3 == 0 {
            con_puntos.push('.');
        }
        con_puntos.push(c);
    }

    let cifra: String = con_puntos.chars().rev().collect();
    if negativo {
        format!("-${cifra}")
    } else {
        format!("${cifra}")
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn pone_el_punto_de_miles() {
        assert_eq!(pesos(640_000), "$640.000");
        assert_eq!(pesos(1_190_000), "$1.190.000");
    }

    #[test]
    fn las_cifras_cortas_van_sin_punto() {
        assert_eq!(pesos(700), "$700");
        assert_eq!(pesos(0), "$0");
    }

    #[test]
    fn el_punto_cae_cada_tres_y_no_al_principio() {
        // Un millar exacto se prestaba a quedar como «$.1000».
        assert_eq!(pesos(1_000), "$1.000");
        assert_eq!(pesos(100), "$100");
    }

    #[test]
    fn el_signo_va_antes_del_peso() {
        // Una correccion de gasto puede dejar una diferencia negativa.
        assert_eq!(pesos(-23_400), "-$23.400");
    }
}
