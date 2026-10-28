/**
 * Sesion del usuario.
 *
 * Guarda quien esta dentro y que puede hacer. Los permisos que trae son
 * para decidir que se muestra; el control de verdad esta en el nucleo,
 * que los vuelve a comprobar en cada operacion.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type { ReactNode } from 'react';

import { MODO_SIMULADO, pedir } from './puente';

export type Rol = 'Administrador' | 'Encargado' | 'Cajero';

export interface Usuario {
  readonly id: number;
  readonly usuario: string;
  readonly nombre: string;
  readonly rol: Rol;
  readonly activo: boolean;
  readonly ultimo_ingreso: string | null;
}

interface SesionIniciada {
  readonly usuario: Usuario;
  readonly permisos: readonly string[];
}

interface EstadoArranque {
  readonly tiene_usuarios: boolean;
  readonly nombre_negocio: string;
  readonly minutos_inactividad: number;
  readonly stock_minimo_defecto: number;
}

interface ContextoSesion {
  readonly usuario: Usuario | null;
  readonly nombreNegocio: string;
  /** Lo que trae un producto nuevo, según Configuración. */
  readonly stockMinimoDefecto: number;
  readonly cargando: boolean;
  /** Falso solo la primera vez que se abre el sistema. */
  readonly hayUsuarios: boolean;
  /** Vuelve a leer los ajustes tras guardarlos, sin reiniciar la app. */
  recargarAjustes(): Promise<void>;
  puede(permiso: string): boolean;
  entrar(usuario: string, contrasena: string): Promise<void>;
  crearPrimerAdministrador(
    usuario: string, nombre: string, contrasena: string, negocio: string,
  ): Promise<void>;
  salir(porInactividad?: boolean): Promise<void>;
}

const Contexto = createContext<ContextoSesion | null>(null);

/**
 * En el navegador, en desarrollo, se entra directo como administrador.
 *
 * No es una puerta trasera: `MODO_SIMULADO` exige `import.meta.env.DEV`,
 * que es falso al empaquetar, y ademas que no haya Tauri. En la
 * aplicacion instalada esta constante es false y el ingreso se pide
 * igual que siempre.
 */
async function sesionDeDesarrollo(): Promise<SesionIniciada | null> {
  if (!import.meta.env.DEV) return null;
  const { SESION_DEV } = await import('./simulador');
  return SESION_DEV;
}

/**
 * Lo que rige hasta que el nucleo conteste, y si contesta cualquier cosa.
 *
 * El mostrador no puede quedarse sin bloqueo por inactividad mientras
 * llega la respuesta: son los mismos valores que trae la base recien
 * instalada.
 */
const AJUSTES_POR_OMISION = { minutosInactividad: 15, stockMinimoDefecto: 3 };

export function ProveedorSesion({ children }: { readonly children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [permisos, setPermisos] = useState<readonly string[]>([]);
  // Vacío a propósito: es el nombre del local, no el del programa. Poner
  // aquí «Punto de Venta» haría que la barra y el recibo mostraran el
  // nombre de la aplicación como si fuera el del negocio.
  const [nombreNegocio, setNombreNegocio] = useState('');
  const [ajustes, setAjustes] = useState(AJUSTES_POR_OMISION);
  const [hayUsuarios, setHayUsuarios] = useState(true);
  const [cargando, setCargando] = useState(true);

  const recargarAjustes = useCallback(async () => {
    const estado = await pedir<EstadoArranque>('estado_arranque');
    setNombreNegocio(estado.nombre_negocio);
    setAjustes({
      minutosInactividad: estado.minutos_inactividad,
      stockMinimoDefecto: estado.stock_minimo_defecto,
    });
  }, []);

  useEffect(() => {
    let vigente = true;
    pedir<EstadoArranque>('estado_arranque')
      .then(async (estado) => {
        if (!vigente) return;
        setHayUsuarios(estado.tiene_usuarios);
        setNombreNegocio(estado.nombre_negocio);
        setAjustes({
          minutosInactividad: estado.minutos_inactividad,
          stockMinimoDefecto: estado.stock_minimo_defecto,
        });
        if (import.meta.env.DEV && MODO_SIMULADO) {
          const sesion = await sesionDeDesarrollo();
          if (!vigente || sesion === null) return;
          setUsuario(sesion.usuario);
          setPermisos(sesion.permisos);
        }
      })
      .catch(() => { /* la pantalla de ingreso lo vuelve a intentar */ })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, []);

  const aplicar = useCallback((sesion: SesionIniciada) => {
    setUsuario(sesion.usuario);
    setPermisos(sesion.permisos);
    setHayUsuarios(true);
  }, []);

  const entrar = useCallback(async (nombre: string, contrasena: string) => {
    aplicar(await pedir<SesionIniciada>('iniciar_sesion', {
      usuario: nombre, contrasena,
    }));
  }, [aplicar]);

  const crearPrimerAdministrador = useCallback(async (
    nombreUsuario: string, nombre: string, contrasena: string, negocio: string,
  ) => {
    aplicar(await pedir<SesionIniciada>('crear_primer_administrador', {
      usuario: nombreUsuario, nombre, contrasena, negocio,
    }));
    setNombreNegocio(negocio.trim());
  }, [aplicar]);

  const salir = useCallback(async (porInactividad = false) => {
    if (usuario !== null) {
      await pedir('cerrar_sesion', {
        usuarioId: usuario.id, porInactividad,
      }).catch(() => { /* salir siempre funciona del lado de la pantalla */ });
    }
    setUsuario(null);
    setPermisos([]);
  }, [usuario]);

  // Bloqueo por inactividad. El temporizador se reinicia con cualquier
  // señal de que hay alguien delante.
  const salirRef = useRef(salir);
  salirRef.current = salir;

  useEffect(() => {
    if (usuario === null) return undefined;

    let temporizador: number;
    const reiniciar = () => {
      window.clearTimeout(temporizador);
      temporizador = window.setTimeout(
        () => { void salirRef.current(true); },
        ajustes.minutosInactividad * 60_000,
      );
    };

    const eventos = ['pointerdown', 'keydown', 'wheel'] as const;
    eventos.forEach((e) => window.addEventListener(e, reiniciar, { passive: true }));
    reiniciar();

    return () => {
      window.clearTimeout(temporizador);
      eventos.forEach((e) => window.removeEventListener(e, reiniciar));
    };
    // Cambiar los minutos en Configuracion rearma el temporizador ahi
    // mismo. Sin esta dependencia el valor nuevo no regiria hasta el
    // siguiente ingreso.
  }, [usuario, ajustes.minutosInactividad]);

  const valor = useMemo<ContextoSesion>(() => ({
    usuario,
    nombreNegocio,
    stockMinimoDefecto: ajustes.stockMinimoDefecto,
    cargando,
    hayUsuarios,
    recargarAjustes,
    puede: (permiso: string) => permisos.includes(permiso),
    entrar,
    crearPrimerAdministrador,
    salir,
  }), [usuario, nombreNegocio, ajustes.stockMinimoDefecto, cargando, hayUsuarios,
       permisos, recargarAjustes, entrar, crearPrimerAdministrador, salir]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSesion(): ContextoSesion {
  const contexto = useContext(Contexto);
  if (contexto === null) {
    throw new Error('useSesion necesita estar dentro de ProveedorSesion');
  }
  return contexto;
}
