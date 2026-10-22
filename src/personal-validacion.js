// Validación y limpieza de expediente. Pura, sin acceso a datos personales ni D1.
export function crearValidadoresPersonal({ RE_CURP, RE_EMAIL, LISTAS }) {
function limpiar(valor, largo, tipo) {
  let v = String(valor ?? "").replace(/\s+/g, " ").trim();
  if (tipo === "tel" || tipo === "cp") v = v.replace(/\D/g, "");
  if (tipo === "tel") v = v.slice(-10);
  if (tipo === "curp") v = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (tipo === "email") v = v.toLowerCase();
  return v.slice(0, largo);
}

function validar(v, tipo) {
  if (!v || !tipo) return "";
  if (tipo === "tel" && v.length !== 10) return "Debe tener 10 dígitos.";
  if (tipo === "cp" && v.length !== 5) return "Debe tener 5 dígitos.";
  if (tipo === "curp" && !RE_CURP.test(v)) return "Revisa la CURP: son 18 letras y números.";
  if (tipo === "email" && !RE_EMAIL.test(v)) return "Correo inválido.";
  if (tipo === "fecha" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return "Fecha inválida.";
  if (tipo.startsWith("lista:") && !LISTAS[tipo.slice(6)].includes(v)) return "Elige una opción.";
  return "";
}

// Lee y valida un conjunto de campos; devuelve { datos, errores }
function leerCampos(cuerpo, campos, requeridos = []) {
  const datos = {}, errores = {};
  for (const [k, largo, tipo] of campos) {
    const v = limpiar(cuerpo[k], largo, tipo);
    if (v) datos[k] = v;
    const e = validar(v, tipo);
    if (e) errores[k] = e;
    else if (!v && requeridos.includes(k)) errores[k] = "Este dato es obligatorio.";
  }
  return { datos, errores };
}

  return { limpiar, validar, leerCampos };
}
