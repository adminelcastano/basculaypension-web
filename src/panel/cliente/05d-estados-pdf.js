// Lector privado de estados: el PDF se interpreta en el navegador, no se sube
// ni se almacena. Los datos sugeridos requieren confirmación antes del POST.
(() => {
  const PDFJS = "/panel/vendor/pdfjs-4.10.38/";
  const MONTHS = { ENE:1,ENERO:1,FEB:2,FEBRERO:2,MAR:3,MARZO:3,ABR:4,ABRIL:4,
    MAY:5,MAYO:5,JUN:6,JUNIO:6,JUL:7,JULIO:7,AGO:8,AGOSTO:8,SEP:9,SEPT:9,SEPTIEMBRE:9,SETIEMBRE:9,
    OCT:10,OCTUBRE:10,NOV:11,NOVIEMBRE:11,DIC:12,DICIEMBRE:12 };
  const normal = s => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\u00a0/g," ").replace(/[ \t]+/g," ").trim();
  const lineasTexto = s => String(s||"").split(/\r?\n/).map(normal).filter(Boolean);
  function fechaISO(d,m,y) {
    const n=Number(d),mes=Number(m),anio=Number(y);
    if(!Number.isInteger(n)||!Number.isInteger(mes)||!Number.isInteger(anio)||anio<2000||anio>2100)return null;
    const t=new Date(Date.UTC(anio,mes-1,n));
    return t.getUTCFullYear()===anio&&t.getUTCMonth()+1===mes&&t.getUTCDate()===n
      ? t.toISOString().slice(0,10) : null;
  }
  function fechaParte(cadena, anioSugerido) {
    const s=normal(cadena).toUpperCase().replace(/[.,]/g," ");
    let x=s.match(/\b(\d{1,2})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{4})\b/);
    if(x)return fechaISO(x[1],x[2],x[3]);
    x=s.match(/\b(\d{1,2})\s*(?:-|\s)+(?:DE\s+)?([A-Z]{3,12})(?:\s*(?:-|\s)+(?:DE\s+)?(\d{4}))?\b/);
    if(x&&MONTHS[x[2]])return fechaISO(x[1],MONTHS[x[2]],x[3]||anioSugerido);
    x=s.match(/\b([A-Z]{3,12})\s+(\d{1,2})\s+(\d{4})\b/);
    if(x&&MONTHS[x[1]])return fechaISO(x[2],MONTHS[x[1]],x[3]);
    return null;
  }
  // Evita interpretar números de nota al pie ("pago mínimo4") como montos.
  function monto(cadena,{permitirNegativo=false}={}) {
    const s=normal(cadena);
    const m=s.match(/(?:\$|MXN\s*)?\s*(-?)\s*(\d{1,3}(?:,\d{3})+\.\d{2}|\d{1,9}\.\d{2})(-?)/i);
    if(!m)return null;
    const n=Number(m[2].replace(/,/g,""));
    return Number.isFinite(n)&&n<=100000000 ? (permitirNegativo&&(m[1]==='-'||m[3]==='-')?-n:n) : null;
  }
  const num = n => n==null?null:n.toFixed(2);
  const valor = (lineas, etiqueta, {permitirSiguiente=true,permitirNegativo=false}={}) => {
    // La etiqueta comienza en el renglón y las cantidades proceden del resumen,
    // no de movimientos aislados, legales ni notas al pie del PDF.
    const base=lineas.slice(0,450);
    for(let i=0;i<base.length;i++){
      const x=base[i],match=x.match(etiqueta);
      if(!match)continue;
      const resto=x.slice(match.index+match[0].length);
      const v=monto(resto,{permitirNegativo});
      if(v!=null)return v;
      if(permitirSiguiente && i+1<base.length && /^\s*(?:\$|MXN)?\s*[-+]?\d[\d,.]*[.-]?\s*$/i.test(base[i+1])) {
        return monto(base[i+1],{permitirNegativo});
      }
    }
    return null;
  };
  const fechaEtiqueta=(lineas,re)=> {
    const base=lineas.slice(0,120);
    for(let i=0;i<base.length;i++)if(re.test(base[i])){
      const str=base[i].replace(re,"").replace(/^\s*\d{1,2}\s+(?=(?:LUNES|MARTES|MIERCOLES|JUEVES|VIERNES|SABADO|DOMINGO)\b)/i,"");
      const d=fechaParte(str)||fechaParte(base[i+1]||"");
      if(d)return d;
    }
    return null;
  };
  const FECHA="(\\d{1,2}\\s*[/\\-]\\s*\\d{1,2}\\s*[/\\-]\\s*\\d{4}|\\d{1,2}\\s*[\\- ]\\s*[A-Za-z]{3,12}\\s*[\\- ]\\s*\\d{4}|\\d{1,2}\\s+de\\s+[A-Za-z]{3,12}(?:\\s+de\\s+\\d{4})?)";
  const periodoRx=new RegExp("\\b(?:PERIODO|PERIODO DE FACTURACION)\\s*:?\\s*(?:DEL?\\s+)?"+FECHA+"\\s+(?:AL?|HASTA)\\s+"+FECHA,"i");
  function periodo(lineas) {
    for(const l of lineas.slice(0,140)) {
      const match=l.match(periodoRx);
      if(!match)continue;
      let fin=fechaParte(match[2]);
      let ini=fechaParte(match[1],fin?.slice(0,4));
      if(ini&&fin&&ini>fin&&!/\d{4}/.test(match[1]))ini=fechaParte(match[1],Number(fin.slice(0,4))-1);
      if(ini&&fin&&ini<=fin)return {periodo_desde:ini,periodo_hasta:fin};
    }
    return {};
  }
  function banco(texto) {
    const s=normal(texto.slice(0,9000)).toUpperCase();
    if(/MAESTRA PYME BBVA|BBVA BANCOMER|BBVA M[NÉ]/.test(s))return "BBVA";
    if(/TARJETA AMERICAN EXPRESS|AMERICAN EXPRESS|\\bAMEX\\b/.test(s))return "AMEX";
    if(/TU PAGO REQUERIDO ESTE PERIODO/.test(s)&&/BANORTE|BANCO MERCANTIL DEL NORTE/.test(s))return "BANORTE";
    if(/TARJETA DE CREDITO NU|NU MEXICO|TARJETA NU/.test(s))return "NU";
    if(/MERCADOLIBRE|MERCADO PAGO/.test(s))return "MERCADO PAGO";
    if(/BANORTE/.test(s))return "BANORTE";
    if(/LIVERPOOL/.test(s))return "LIVERPOOL";
    return null;
  }
  // Mercado Pago dispone en ocasiones varias ETIQUETAS en una fila y
  // todos los IMPORTES en la siguiente. No asociar el primer importe a
  // varias etiquetas ni leer movimientos como totales del estado.
  function totalesMercadoPago(lineas) {
    const corte=lineas.findIndex(x=>/^DETALLE DE MOVIMIENTOS\b/i.test(x));
    const resumen=lineas.slice(0,corte<0?140:Math.min(corte,140));
    const etiquetas=/\b(SALDO INICIAL|ABONOS|COMISIONES TOTALES|SALDO FINAL|PROMEDIO DIARIO DE SALDOS|CARGOS|RETENCIONES POR IMPUESTOS)\s*:/gi;
    const divisas=/(?:-?\s*\$\s*|-?\s*MXN\s*)(\d{1,3}(?:,\d{3})+\.\d{2}|\d{1,9}\.\d{2})(-?)/gi;
    const claves={"SALDO INICIAL":"saldo_inicial","ABONOS":"abonos","SALDO FINAL":"saldo_final","CARGOS":"cargos"};
    const totales={};
    for(let i=0;i+1<resumen.length;i++){
      const cabecera=resumen[i];
      const encontradas=[...cabecera.matchAll(etiquetas)].map(x=>x[1].toUpperCase());
      // Exigir cabecera limpia y dos o más títulos de un resumen, no texto
      // ambiguo, cantidades mezcladas ni renglones de operaciones.
      if(encontradas.length<2||cabecera.replace(etiquetas,"").trim())continue;
      const fila=resumen[i+1],importes=[...fila.matchAll(divisas)];
      if(importes.length!==encontradas.length||fila.replace(divisas,"").trim())continue;
      for(let j=0;j<encontradas.length;j++){
        const clave=claves[encontradas[j]];
        const cantidad=monto(importes[j][0],{permitirNegativo:clave==="saldo_inicial"||clave==="saldo_final"});
        if(clave&&cantidad!=null&&totales[clave]==null)totales[clave]=cantidad;
      }
    }
    // Algunos estados presentan una etiqueta y su importe en líneas separadas.
    // No tomar un importe si comparte su línea con otra etiqueta o concepto.
    const simple={
      saldo_inicial:/^SALDO INICIAL\s*:/i,saldo_final:/^SALDO FINAL\s*:/i,
      abonos:/^ABONOS\s*:/i,cargos:/^CARGOS\s*:/i
    };
    for(const [clave,rx] of Object.entries(simple)){
      if(totales[clave]!=null)continue;
      for(let i=0;i<resumen.length;i++){
        if(!rx.test(resumen[i]))continue;
        const resto=resumen[i].replace(rx,"").trim();
        const candidato=resto||(resumen[i+1]||"").trim();
        if(!/^(?:-?\s*\$|-?\s*MXN)?\s*-?\d[\d,.]*-?$/i.test(candidato))continue;
        const valorSeguro=monto(candidato,{permitirNegativo:clave==="saldo_inicial"||clave==="saldo_final"});
        if(valorSeguro!=null){totales[clave]=valorSeguro;break;}
      }
    }
    return totales;
  }
  const creditoRx={
    saldo_inicial:/^ADEUDO DEL PERIODO ANTERIOR\s*(?:=|:)?\s*/i,
    saldo_final:/^SALDO DEUDOR TOTAL(?:\d{1,2})?\s*(?:=|:)?\s*/i,
    abonos:/^PAGOS Y ABONOS\s*(?:-|=|:)?\s*/i,
    intereses:/^MONTO DE INTERESES(?:\d{1,2})?\s*(?:\+|=|:)?\s*/i,
    comisiones:/^MONTO DE COMISIONES\s*(?:\+|=|:)?\s*/i,
    iva:/^IVA DE INTERESES Y COMISIONES(?:\d{1,2})?\s*(?:\+|=|:)?\s*/i
  };
  function analizarTexto(texto, { paginas=1 }={}) {
    const l=lineasTexto(texto),n=l.map(x=>normal(x).toUpperCase());
    const institucion=banco(texto);
    const campos=periodo(n),advertencias=[];
    if(!institucion){
      return {institucion:null,tipo:null,campos:{},advertencias:["No se identificó una institución compatible. Captura este documento manualmente."],paginas,fiable:false};
    }
    if(institucion==="LIVERPOOL"){
      return {institucion,tipo:"credito",campos:{},advertencias:["El formato de Liverpool aún no está verificado para extracción automática."],paginas,fiable:false};
    }
    const credito=["BANORTE","NU","AMEX"].includes(institucion);
    const tipo=credito?"credito":"debito";
    const insertar=(k,v)=>{if(v!=null&&Number.isFinite(v))campos[k]=num(v);};
    campos.fecha_corte=fechaEtiqueta(n,/^FECHA DE CORTE\s*:?/i)||campos.periodo_hasta;
    if(credito)campos.fecha_pago_limite=fechaEtiqueta(n,/^FECHA LIMITE DE PAGO(?:\d{1,2})?\s*:?/i);
    if(institucion==="BBVA"){
      insertar("saldo_inicial",valor(n,/^SALDO ANTERIOR\s*/,{permitirNegativo:true}));
      insertar("saldo_final",valor(n,/^SALDO FINAL\s*/,{permitirNegativo:true}));
      insertar("abonos",valor(n,/^DEPOSITOS\/ABONOS\s*\(\+\)\s*(?:\d+\s+)?/));
      insertar("cargos",valor(n,/^RETIROS\/CARGOS\s*\(-\)\s*(?:\d+\s+)?/));
      advertencias.push("BBVA puede mostrar comisiones que se aplicarán en el siguiente estado: no se propone ese desglose sin verificar movimientos.");
    }else if(institucion==="MERCADO PAGO"){
      const resumen=totalesMercadoPago(n);
      for(const [campo,importe] of Object.entries(resumen))insertar(campo,importe);
      advertencias.push("Revisa si las comisiones de Mercado Pago ya están incluidas en cargos; no se suman dos veces.");
    }else if(institucion==="BANORTE"||institucion==="NU"){
      for(const [k,exp] of Object.entries(creditoRx))insertar(k,valor(n,exp,{permitirNegativo:k==="saldo_inicial"||k==="saldo_final"}));
      const gastos=[
        valor(n,/^CARGOS REGULARES\s*\(NO A MESES\)\s*(?:\+|=|:)?/),
        valor(n,/^CARGOS (?:Y )?COMPRAS A MESES\s*\(CAPITAL\)(?:\d{1,2})?\s*(?:\+|=|:)?/),
        ...["intereses","comisiones","iva"].map(k=>campos[k]==null?null:Number(campos[k]))
      ];
      if(gastos.every(x=>x!=null))insertar("cargos",gastos.reduce((a,b)=>a+b,0));
      campos.pago_minimo=num(valor(n,/^PAGO MINIMO(?:\d{1,2})?\s*:/));
      campos.pago_sin_intereses=num(valor(n,/^PAGO PARA NO GENERAR INTERESES(?:\d{1,2})?\s*(?:=|:)/));
      advertencias.push("El saldo deudor total de una tarjeta puede incluir compras a meses todavía no exigibles; revisa la consistencia y no confundas ese saldo con el pago para no generar intereses.");
    }else if(institucion==="AMEX"){
      insertar("intereses",valor(n,/^INTERES FINANCIERO\s*:/));
      insertar("comisiones",valor(n,/^COMISIONES\s*:/));
      insertar("iva",valor(n,/^IVA\s*:/));
      insertar("cargos",valor(n,/^TOTAL NUEVOS CARGOS\s*:/));
      insertar("pago_minimo",valor(n,/^PAGO MINIMO\s*:/));
      advertencias.push("El resumen Amex reúne saldos y pagos en una tabla: revisa manualmente saldo anterior, abonos, saldo actual y pago para no generar intereses.");
    }
    // Ceros vacíos del PDF no se inventan. Los campos numéricos deben provenir
    // de renglones concretos; si faltan quedan sin propuesta.
    for(const [k,v] of Object.entries(campos))if(v==null||v==="")delete campos[k];
    const obligatorios=["periodo_desde","periodo_hasta","fecha_corte","saldo_inicial","saldo_final","cargos","abonos"];
    const faltan=obligatorios.filter(k=>campos[k]==null);
    if(faltan.length)advertencias.push("Faltan datos para comprobar el estado completo: "+faltan.join(", ").replaceAll("_"," ")+".");
    if(["saldo_inicial","saldo_final","cargos","abonos"].every(k=>campos[k]!=null)){
      const inicio=Number(campos.saldo_inicial),cargos=Number(campos.cargos),abonos=Number(campos.abonos);
      const saldo=Number(campos.saldo_final);
      const esperado=inicio+(tipo==="credito"?cargos-abonos:abonos-cargos);
      const diferencia=Math.round((saldo-esperado)*100)/100;
      if(Math.abs(diferencia)>=0.01)
        advertencias.push("La comprobación matemática preliminar presenta una diferencia de $"+
          Math.abs(diferencia).toFixed(2)+". Puede haber compras diferidas u otras operaciones: revisa el PDF antes de guardar.");
    }
    // Las fechas por sí solas jamás confirman una lectura bancaria confiable.
    const importesEncontrados=["saldo_inicial","saldo_final","cargos","abonos","pago_minimo","pago_sin_intereses"]
      .filter(k=>campos[k]!=null).length;
    if(importesEncontrados<2)
      advertencias.push("No se extrajeron suficientes importes del resumen. Revisa el PDF y utiliza captura manual.");
    const fiable=!!campos.periodo_desde&&!!campos.periodo_hasta&&!!institucion&&importesEncontrados>=2;
    return {institucion,tipo,campos,advertencias,paginas,fiable};
  }
  let moduloPDF=null;
  async function extraerPDF(file) {
    if(!file||!(/\.pdf$/i.test(file.name)||file.type==="application/pdf"))throw Error("Selecciona un archivo PDF.");
    if(file.size>12*1024*1024)throw Error("El PDF supera 12 MB; utiliza uno más pequeño o captura sus datos manualmente.");
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(String.fromCharCode(...bytes.subarray(0,5))!=="%PDF-")throw Error("El archivo no tiene una cabecera PDF válida.");
    // Librería servida por nuestro propio Worker tras Cloudflare Access.
    // Solo se pasan bytes locales: no hay POST, URL del PDF ni almacenamiento.
    if(!moduloPDF)moduloPDF=await import(PDFJS+"pdf.min.mjs");
    moduloPDF.GlobalWorkerOptions.workerSrc=PDFJS+"pdf.worker.min.mjs";
    const task=moduloPDF.getDocument({data:bytes,isEvalSupported:false});
    let doc;
    try{
      doc=await task.promise;
      if(doc.numPages>30)throw Error("El PDF tiene más de 30 páginas. Selecciona un estado más corto.");
      let texto="",paginas=0;
      for(let p=1;p<=doc.numPages;p++){
        const pg=await doc.getPage(p),items=(await pg.getTextContent()).items.filter(x=>typeof x.str==="string");
        const lineas=[]; // reconstrucción local de renglones por coordenadas
        for(const it of items){
          const y=it.transform?.[5]??0, x=it.transform?.[4]??0;
          let row=lineas.find(r=>Math.abs(r.y-y)<2.5);
          if(!row){row={y,celdas:[]};lineas.push(row);}
          row.celdas.push({x,text:it.str});
        }
        lineas.sort((a,b)=>b.y-a.y);
        texto+=lineas.map(r=>r.celdas.sort((a,b)=>a.x-b.x).map(a=>a.text).join(" ").trim()).join("\n")+"\n";
        paginas++;
        if(texto.length>280000)throw Error("El estado contiene demasiado texto para revisar con seguridad.");
      }
      if(texto.trim().length<80)throw Error("No se pudo leer texto del PDF. Puede estar escaneado; captura los importes manualmente.");
      return analizarTexto(texto,{paginas});
    }finally{if(doc)await doc.destroy();else await task.destroy();}
  }
  EC.analizarEstadoTexto=analizarTexto;
  EC.extraerEstadoPDF=extraerPDF;
})();