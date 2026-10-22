# FABRI-CORE · Criterios de aceptación

> Generado desde el spec. Cada criterio es binario: pasa o no pasa.

1. La APK compila en el dispositivo o informa de forma precisa qué dependencia falta
2. La base de datos persiste al cerrar y reiniciar la aplicación
3. FTS5 encuentra documentos de prueba si está disponible
4. La búsqueda vectorial solo aparece activa cuando existen embeddings utilizables
5. El selector de tema cambia todos los componentes y persiste
6. Se importa un logo PNG y SVG de forma segura y se muestra correctamente en la vista previa
7. Se exportan PDF, CSV y XLSX de datos reales
8. Los catálogos de productos y documentos tienen rutas independientes
9. El flujo animado refleja eventos reales y distingue claramente los estados sin conexión
10. Los trabajos de instalación conservan estado y errores
11. No se muestran estadísticas ficticias en producción
12. Las operaciones destructivas requieren confirmación
13. Se puede crear y restaurar una copia de seguridad de prueba

## Política de exportación

| Formato | Uso |
|---|---|
| PDF | Informes, fichas de productos, facturas registradas y documentos imprimibles |
| XLSX | Análisis de tablas, productos, inventario, facturas y reportes |
| CSV | Intercambio de datos tabulares |
| print | Android Print Framework y selector de destino cuando sea compatible |

- Previsualizar antes de exportar
- Usar el logo y tema de marca configurados
- Permitir seleccionar columnas y rango de fechas
- Mostrar progreso real
- Usar Android Storage Access Framework para guardar el archivo
- No llamar factura tributaria oficial a un reporte interno
- Mantener trazabilidad de exportación

