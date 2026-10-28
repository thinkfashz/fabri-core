package cl.fabrick.core;

import java.io.File;
import java.io.FileOutputStream;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Prueba de escritorio de {@link LectorXlsx}. Genera un .xlsx mínimo (dos hojas,
 * cadenas compartidas con rich text, texto inline, números, booleanos y una
 * fórmula con valor cacheado) y verifica lo que devuelve el lector.
 *
 * <p>No usa Android: se compila y corre con el JDK del escritorio.
 */
public final class LectorXlsxPrueba {

    private static int fallos = 0;

    private static void ok(String t) {
        System.out.println("  \u001b[1;32m✔\u001b[0m " + t);
    }

    private static void mal(String t) {
        System.out.println("  \u001b[1;31m✖\u001b[0m " + t);
        fallos++;
    }

    private static void igual(Object a, Object b, String t) {
        if (a == null ? b == null : a.equals(b)) ok(t + " = " + b);
        else mal(t + ": esperaba " + b + ", llegó " + a);
    }

    public static void main(String[] args) throws Exception {
        File tmp = File.createTempFile("fabri-xlsx-", ".xlsx");
        tmp.deleteOnExit();
        escribir(tmp);

        List<LectorXlsx.Hoja> hojas = LectorXlsx.leer(tmp);
        igual(hojas.size(), 2, "hojas leídas");
        igual(hojas.get(0).nombre, "Productos", "nombre de la primera hoja");
        igual(hojas.get(1).nombre, "Resumen", "nombre de la segunda hoja");

        List<List<String>> filas = hojas.get(0).filas;
        igual(filas.size(), 4, "filas de Productos");
        igual(filas.get(0).get(0), "Nombre", "encabezado A1");
        igual(filas.get(0).get(1), "Código", "encabezado B1");
        igual(filas.get(1).get(0), "Arroz grado 1", "texto compartido");
        igual(filas.get(1).get(1), "7801234567890", "número como texto");
        igual(filas.get(1).get(2), "1490", "número entero");
        igual(filas.get(1).get(3), "24", "stock");
        igual(filas.get(2).get(0), "Aceite 1 L", "texto inline");
        igual(filas.get(2).get(2), "3290.5", "decimal");
        igual(filas.get(3).get(0), "Texto enriquecido", "rich text concatenado");
        igual(filas.get(3).get(2), "42", "fórmula con valor cacheado");
        igual(filas.get(3).get(3), "1", "booleano");

        List<List<String>> resumen = hojas.get(1).filas;
        igual(resumen.size(), 1, "filas de Resumen");
        igual(resumen.get(0).get(0), "Total", "celda de la segunda hoja");
        igual(resumen.get(0).get(1), "2", "valor de la segunda hoja");

        // Un archivo que no es ZIP debe fallar con un error claro, no colgarse.
        File falso = File.createTempFile("fabri-xlsx-falso-", ".xlsx");
        falso.deleteOnExit();
        FileOutputStream salida = new FileOutputStream(falso);
        salida.write("no soy un zip".getBytes("UTF-8"));
        salida.close();
        try {
            LectorXlsx.leer(falso);
            mal("un archivo inválido debería fallar");
        } catch (Exception e) {
            ok("un archivo inválido falla con excepción");
        }

        System.out.println();
        if (fallos == 0) {
            System.out.println("\u001b[1;32m✔ LectorXlsx: todo en orden\u001b[0m");
            System.exit(0);
        }
        System.out.println("\u001b[1;31m✖ " + fallos + " fallo(s)\u001b[0m");
        System.exit(1);
    }

    private static void escribir(File destino) throws Exception {
        ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(destino));
        try {
            entrada(zip, "[Content_Types].xml",
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
                + "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                + "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>"
                + "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
                + "<Override PartName=\"/xl/worksheets/sheet2.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
                + "<Override PartName=\"/xl/sharedStrings.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml\"/>"
                + "</Types>");

            entrada(zip, "_rels/.rels",
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>"
                + "</Relationships>");

            entrada(zip, "xl/workbook.xml",
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                + "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" "
                + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">"
                + "<sheets>"
                + "<sheet name=\"Productos\" sheetId=\"1\" r:id=\"rId1\"/>"
                + "<sheet name=\"Resumen\" sheetId=\"2\" r:id=\"rId2\"/>"
                + "</sheets></workbook>");

            entrada(zip, "xl/_rels/workbook.xml.rels",
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>"
                + "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet2.xml\"/>"
                + "</Relationships>");

            entrada(zip, "xl/sharedStrings.xml",
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                + "<sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" count=\"5\" uniqueCount=\"5\">"
                + "<si><t>Nombre</t></si>"
                + "<si><t>Código</t></si>"
                + "<si><t>Arroz grado 1</t></si>"
                + "<si><r><t>Texto </t></r><r><t>enriquecido</t></r></si>"
                + "<si><t>Total</t></si>"
                + "</sst>");

            entrada(zip, "xl/worksheets/sheet1.xml",
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                + "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
                + "<sheetData>"
                + fila(1, "<c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"s\"><v>1</v></c>"
                    + "<c r=\"C1\" t=\"inlineStr\"><is><t>Precio</t></is></c><c r=\"D1\" t=\"inlineStr\"><is><t>Stock</t></is></c>")
                + fila(2, "<c r=\"A2\" t=\"s\"><v>2</v></c><c r=\"B2\" t=\"inlineStr\"><is><t>7801234567890</t></is></c>"
                    + "<c r=\"C2\"><v>1490</v></c><c r=\"D2\"><v>24</v></c>")
                + fila(3, "<c r=\"A3\" t=\"inlineStr\"><is><t>Aceite 1 L</t></is></c>"
                    + "<c r=\"B3\" t=\"inlineStr\"><is><t>7809876543210</t></is></c>"
                    + "<c r=\"C3\"><v>3290.5</v></c><c r=\"D3\"><v>8</v></c>")
                + fila(4, "<c r=\"A4\" t=\"s\"><v>3</v></c>"
                    + "<c r=\"C4\"><f>A2*2</f><v>42</v></c><c r=\"D4\" t=\"b\"><v>1</v></c>")
                + "</sheetData></worksheet>");

            entrada(zip, "xl/worksheets/sheet2.xml",
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                + "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
                + "<sheetData>"
                + fila(1, "<c r=\"A1\" t=\"s\"><v>4</v></c><c r=\"B1\"><v>2</v></c>")
                + "</sheetData></worksheet>");
        } finally {
            zip.close();
        }
    }

    private static String fila(int n, String celdas) {
        return "<row r=\"" + n + "\">" + celdas + "</row>";
    }

    private static void entrada(ZipOutputStream zip, String nombre, String contenido) throws Exception {
        zip.putNextEntry(new ZipEntry(nombre));
        zip.write(contenido.getBytes("UTF-8"));
        zip.closeEntry();
    }
}
