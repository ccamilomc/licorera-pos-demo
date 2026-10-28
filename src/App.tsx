/**
 * Raiz de la aplicacion.
 *
 * Decide una sola cosa: si hay sesion, se entra al sistema; si no, se
 * muestra el ingreso.
 */

import { ProveedorSesion, useSesion } from './nucleo/sesion';
import { PantallaIngreso } from './modulos/usuarios/PantallaIngreso';
import { Escritorio } from './nucleo/Escritorio';

function Contenido() {
  const { usuario, cargando } = useSesion();

  if (cargando) {
    return (
      <div className="flex min-h-full items-center justify-center bg-fondo">
        <p className="text-sm text-tinta-3">Abriendo el sistema…</p>
      </div>
    );
  }

  return usuario === null ? <PantallaIngreso /> : <Escritorio />;
}

export function App() {
  return (
    <ProveedorSesion>
      <Contenido />
    </ProveedorSesion>
  );
}
