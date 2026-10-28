/**
 * Lo que se ve cuando una pantalla se rompe.
 *
 * Sin esto, un error en cualquier componente deja la ventana **en blanco**:
 * ni un mensaje, ni un botón, nada. Pasó de verdad mientras se construía
 * —un campo que el núcleo no mandaba— y la aplicación entera desapareció
 * por eso.
 *
 * En un mostrador eso es lo peor que puede pasar: el dueño no sabe si se
 * dañó el programa, si perdió los datos o si se le fue la luz, y no tiene
 * a quién preguntarle. Un aviso que diga qué pasó y ofrezca volver
 * convierte un desastre en un mal rato.
 *
 * Se envuelve cada módulo por separado, no la aplicación entera: si se
 * rompe Reportes, la caja tiene que seguir cobrando.
 */

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';

interface Props {
  /** Cómo se llama lo que está adentro, para poder nombrarlo. */
  readonly nombre: string;
  readonly children: ReactNode;
}

interface Estado {
  readonly error: Error | null;
}

export class Salvavidas extends Component<Props, Estado> {
  override state: Estado = { error: null };

  static getDerivedStateFromError(error: Error): Partial<Estado> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // A la consola, que es donde queda el rastro para revisarlo después.
    // eslint-disable-next-line no-console
    console.error(`Se rompió ${this.props.nombre}:`, error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    // Al reintentar no hace falta forzar nada: cuando un salvavidas
    // atrapa un error, React ya desmontó todo lo que colgaba de él, así
    // que lo de adentro se monta de cero por su cuenta.
    if (error === null) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-lg border border-grave/40 bg-panel p-6">
          <div className="flex items-start gap-3">
            <TriangleAlert size={22} className="mt-0.5 shrink-0 text-grave" aria-hidden />
            <div>
              <h2 className="text-base font-bold">
                Se dañó la pantalla de {this.props.nombre}
              </h2>
              <p className="mt-1.5 text-[13px] text-tinta-2">
                No se perdió nada: tus datos están guardados. Lo demás del
                programa sigue funcionando, así que puedes seguir cobrando
                mientras tanto.
              </p>
            </div>
          </div>

          <p className="mt-3 rounded border border-linea bg-panel-2 px-3 py-2
                        text-[12px] text-tinta-3">
            {error.message}
          </p>

          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-4 inline-flex items-center gap-2 rounded bg-acento px-4 py-2
                       text-sm font-bold text-sobre-acento hover:bg-acento-fuerte"
          >
            <RotateCcw size={15} aria-hidden />
            Volver a intentar
          </button>
        </div>
      </div>
    );
  }
}
