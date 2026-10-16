(async function procesarDatos() {
  try {
   
    const rawData = input.data.Busqueda1;
    const rawIDN = input.data.Busqueda2;
    const rawDiasLV = input.data.DiasLV;
    const rawDiasS = input.data.DiasS; 
    const rawDiasD = input.data.DiasD;  

    const currentYear = input.data && input.data.anio ? Number(input.data.anio) : new Date().getFullYear();
    const currentMonth = input.data && input.data.mes ? Number(input.data.mes) : (new Date().getMonth() + 1);

    if (!rawData) {
      throw new Error('La variable de entrada "data.Busqueda1" está vacía o indefinida.');
    }

    let listaLeads = [];
    if (typeof rawData === 'string') {
      let textLimpio = rawData.trim();
      if (!textLimpio.startsWith('[')) textLimpio = `[${textLimpio}]`;
      listaLeads = JSON.parse(textLimpio);
    } else if (Array.isArray(rawData)) {
      listaLeads = rawData;
    } else if (typeof rawData === 'object' && rawData !== null) {
      listaLeads = rawData.data || rawData.leads || [rawData];
    }

    if (!Array.isArray(listaLeads) || listaLeads.length === 0) {
      throw new Error('La variable "data.Busqueda1" no contiene una lista de leads válida.');
    }

    let idsNuevos = new Set();
    const extraerIDsRecursivo = (val) => {
      if (!val) return;
      if (typeof val === 'string') {
        let str = val.trim();
        if (str.startsWith('[') || str.startsWith('{')) {
          try { extraerIDsRecursivo(JSON.parse(str)); return; } catch (e) {}
        }
        const idsEncontrados = str.match(/([a-fA-F0-9]{24}|[a-zA-Z0-9_\-]{5,})/g);
        if (idsEncontrados) {
          const reservadas = new Set(['id', 'idn', 'text', 'value', 'null', 'undefined', 'usuario', 'true', 'false']);
          idsEncontrados.forEach(id => { if (!reservadas.has(id.toLowerCase())) idsNuevos.add(id.trim()); });
        }
        return;
      }
      if (typeof val === 'number') { idsNuevos.add(String(val).trim()); return; }
      if (Array.isArray(val)) { val.forEach(item => extraerIDsRecursivo(item)); return; }
      if (typeof val === 'object') {
        const idExtraido = val.idN || val.IDN || val.id || val["Usuario: ID de Usuario"];
        if (idExtraido) extraerIDsRecursivo(idExtraido);
        for (const key of Object.keys(val)) extraerIDsRecursivo(val[key]);
      }
    };

    if (rawIDN) extraerIDsRecursivo(rawIDN);


    const metricasAsesores = {};
    listaLeads.forEach((lead) => {
      const rawId = lead["id"] || lead["ID"] || lead["id_asesor"] || lead["asesor_id"] || lead["user_id"] || "Sin_ID";
      const idAsesor = String(rawId).trim();
      const fechaFactura = lead["fecha_factura"] || lead["Fecha Factura"] || lead["fechaFactura"];
      const esVentaValida = fechaFactura && String(fechaFactura).trim() !== "" && String(fechaFactura).trim() !== "null" && String(fechaFactura).trim() !== "undefined";

      if (!metricasAsesores[idAsesor]) metricasAsesores[idAsesor] = { id: idAsesor, visitas: 0, ventas: 0 };
      metricasAsesores[idAsesor].visitas += 1;
      if (esVentaValida) metricasAsesores[idAsesor].ventas += 1;
    });

    idsNuevos.forEach(idNuevo => {
      if (!metricasAsesores[idNuevo]) {
        metricasAsesores[idNuevo] = { id: idNuevo, visitas: 0, ventas: 0 };
      }
    });

    const totalAsesores = Object.keys(metricasAsesores).length;

   
    const leerCantidadDia = (raw, porDefecto) => {
      if (raw === undefined || raw === null || String(raw).trim() === "") return porDefecto;
      const n = Number(String(raw).trim());
      return (Number.isFinite(n) && n >= 0) ? Math.floor(n) : porDefecto;
    };

    const reqLunesViernes = leerCantidadDia(rawDiasLV, 2);
    const reqSabado = leerCantidadDia(rawDiasS, 2);
    const reqDomingo = leerCantidadDia(rawDiasD, 1);

    const maxRequeridoPorDia = Math.max(reqLunesViernes, reqSabado, reqDomingo);
    if (totalAsesores < maxRequeridoPorDia) {
      throw new Error(`Hay ${totalAsesores} asesores pero un día requiere ${maxRequeridoPorDia} guardias. Cada asesor solo puede cubrir una guardia por día.`);
    }

    const totalDiasMes = new Date(currentYear, currentMonth, 0).getDate();
    const slotsDisponibles = [];

    for (let day = 1; day <= totalDiasMes; day++) {
      
      const fechaActual = new Date(currentYear, currentMonth - 1, day);
      const diaSemanaJS = fechaActual.getDay(); 

      let cantidadRequerida = reqLunesViernes;
      if (diaSemanaJS === 0) {
        cantidadRequerida = reqDomingo;
      } else if (diaSemanaJS === 6) {
        cantidadRequerida = reqSabado;
      }

      const cantidadGD = Math.ceil(cantidadRequerida / 2);
      const cantidadGN = cantidadRequerida - cantidadGD;
      for (let i = 0; i < cantidadGD; i++) slotsDisponibles.push({ dia_numero: day, tipo_turno: 'GD' });
      for (let i = 0; i < cantidadGN; i++) slotsDisponibles.push({ dia_numero: day, tipo_turno: 'GN' });
    }

    const totalGuardiasBase = slotsDisponibles.length;
    if (totalGuardiasBase === 0) {
      throw new Error('Los cupos DiasLV, DiasS y DiasD suman 0 guardias en el mes.');
    }

   
    const listaCalculada = [];
    let sumaPorcentajesCierre = 0;

    for (const [_, datos] of Object.entries(metricasAsesores)) {
      let pctCierreCalculado = datos.visitas > 0 ? (datos.ventas / datos.visitas) * 100 : 0;
      let pctCierreFinal = pctCierreCalculado;

      if (idsNuevos.has(datos.id) && pctCierreCalculado < 10) {
        pctCierreFinal = 10;
      }

      sumaPorcentajesCierre += pctCierreFinal;
      listaCalculada.push({ id: datos.id, visitas: datos.visitas, ventas: datos.ventas, pctCierre: pctCierreFinal });
    }

    let totalAsignadoBase = 0;
    let itemsCalculados = listaCalculada.map((asesor) => {
      const pesoEspecifico = sumaPorcentajesCierre > 0 ? (asesor.pctCierre / sumaPorcentajesCierre) : (1 / listaCalculada.length);
      const guardiasExactas = pesoEspecifico * totalGuardiasBase;
      const guardiasBase = Math.floor(guardiasExactas);
      const residuo = guardiasExactas - guardiasBase;

      totalAsignadoBase += guardiasBase;
      return { ...asesor, guardiasBase, residuo, guardiasFinales: guardiasBase };
    });

    let guardiasFaltantes = totalGuardiasBase - totalAsignadoBase;
    itemsCalculados.sort((a, b) => b.residuo - a.residuo);

    for (let i = 0; i < guardiasFaltantes; i++) {
      itemsCalculados[i % itemsCalculados.length].guardiasFinales += 1;
    }

    itemsCalculados.forEach(asesor => {
      asesor.GD_dias = [];
      asesor.GN_dias = [];
    });

    const totalDe = (a) => a.GD_dias.length + a.GN_dias.length;
    const tieneDia = (a, dia) => a.GD_dias.includes(dia) || a.GN_dias.includes(dia);

   
    slotsDisponibles.forEach(slot => {
      const sinEseDia = itemsCalculados.filter(a => !tieneDia(a, slot.dia_numero));

      let candidatos = sinEseDia.filter(a => totalDe(a) < a.guardiasFinales);
      if (candidatos.length === 0) candidatos = sinEseDia;

      const listaTurno = (a) => slot.tipo_turno === 'GD' ? a.GD_dias : a.GN_dias;

      candidatos.sort((a, b) => {
        const difTotal = totalDe(a) - totalDe(b);
        if (difTotal !== 0) return difTotal;
        return listaTurno(a).length - listaTurno(b).length;
      });

      const elegido = candidatos[0];
      if (!elegido) {
        throw new Error(`No hay asesor disponible para el día ${slot.dia_numero} (${slot.tipo_turno}).`);
      }
      listaTurno(elegido).push(slot.dia_numero);
    });

   
    itemsCalculados.forEach(asesor => {
      asesor.GD_dias = [...new Set(asesor.GD_dias)].sort((x, y) => x - y);
      asesor.GN_dias = [...new Set(asesor.GN_dias)].sort((x, y) => x - y);
    });

    
    const payload = itemsCalculados.map(asesor => ({
      id: String(asesor.id),
      guardias_asignadas: String(asesor.GD_dias.length + asesor.GN_dias.length),
      ventas: Number(asesor.ventas),
      visitas: Number(asesor.visitas),
      porcentaje: `${asesor.pctCierre.toFixed(2)}%`,
      GD: String(asesor.GD_dias.join(", ")),
      GN: String(asesor.GN_dias.join(", "))
    }));

    output["resultado"] = payload;

  } catch (err) {
    output["error"] = err.message;
  }
})();