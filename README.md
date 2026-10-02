# Ajustador de Siniestros

Aplicación para liquidadores de seguros: sube la carpeta de un siniestro (acta, provisión, presupuesto del contratista, fotografías) y genera el **ajuste de pérdida** en Excel, el **informe de liquidación** en Word y PDF y el **anexo de fotografías**, con un agente (Gemini) que actúa como perito senior.

- Documentación: [`docs/`](docs) — análisis, plan, prompt maestro, estado y despliegue.
- Estado y cómo ejecutar: [`docs/04-estado-y-despliegue.md`](docs/04-estado-y-despliegue.md)
- Memoria técnica del proyecto: [`DEVmemory.md`](DEVmemory.md)

```bash
npm install
DB_MODE=pglite npm run dev   # base embebida; en producción usa DATABASE_URL + DB_SCHEMA
npm test
```
