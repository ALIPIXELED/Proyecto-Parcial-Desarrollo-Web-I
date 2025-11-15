
// API para obtener una tabla real (por ahora Bundesliga, luego te hago la de La Liga)
const API_TABLA = "https://api.openligadb.de/getbltable/bl1/2023";

// Función principal
async function cargarTablaPosiciones() {
    const tbody = document.getElementById("tabla-posiciones-body");

    if (!tbody) {
        console.error(" No se encontró el elemento <tbody id='tabla-posiciones-body'>");
        return;
    }

    try {
        // limpiar por si acaso
        tbody.innerHTML = "";

        // pedir los datos a la API REST
        const resp = await fetch(API_TABLA);

        if (!resp.ok) {
            throw new Error("HTTP error " + resp.status);
        }

        const equipos = await resp.json();

        // recorrer equipos y agregarlos como filas
        equipos.forEach((equipo, index) => {
            const tr = document.createElement("tr");

            // crear columnas
            const datos = [
                index + 1,
                equipo.TeamName || "Equipo",
                equipo.Matches ?? "-",
                equipo.Won ?? "-",       // PG (ganados)
                equipo.Draw ?? "-",      // PE (empatados)
                equipo.Lost ?? "-",      // PP (perdidos)
                equipo.Points ?? "-"     // PTS
            ];

            datos.forEach(valor => {
                const td = document.createElement("td");
                td.textContent = valor;
                td.className = "border px-2 py-1";
                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        });

    } catch (error) {
        console.error("Error cargando tabla:", error);

        // mostrar error dentro del tbody
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 7;
        td.textContent = "Error cargando datos de la tabla.";
        td.style.color = "red";
        td.style.textAlign = "center";
        tr.appendChild(td);
        tbody.appendChild(tr);
    }
}

// Ejecutar cuando cargue la página
document.addEventListener("DOMContentLoaded", cargarTablaPosiciones);
