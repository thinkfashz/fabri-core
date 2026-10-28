package cl.fabrick.core;

import org.xml.sax.Attributes;
import org.xml.sax.helpers.DefaultHandler;

import javax.xml.parsers.SAXParser;
import javax.xml.parsers.SAXParserFactory;
import java.io.File;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Lector de libros Excel .xlsx sin dependencias externas.
 *
 * <p>Un .xlsx es un ZIP con XML. Se leen las cadenas compartidas, el índice de
 * hojas y la primera hoja (o la que el usuario elija). No se interpretan
 * fórmulas ni estilos: se devuelve el valor cacheado, que es lo que exporta
 * cualquier sistema de punto de venta.
 *
 * <p>Es Java puro (java.util.zip + SAX) para poder compilarlo y probarlo en el
 * escritorio, fuera de Android. El puente lo envuelve en JSON.
 */
final class LectorXlsx {

    static final int MAX_FILAS = 20000;
    static final int MAX_COLUMNAS = 60;
    static final int MAX_HOJAS = 12;

    static final class Hoja {
        String nombre;
        final List<List<String>> filas = new ArrayList<List<String>>();
        boolean truncada = false;
    }

    private LectorXlsx() {
    }

    /** Lee todas las hojas del libro (hasta MAX_HOJAS). */
    static List<Hoja> leer(File archivo) throws Exception {
        if (archivo == null || !archivo.isFile()) {
            throw new IllegalArgumentException("el archivo Excel no existe");
        }
        ZipFile zip = null;
        try {
            zip = new ZipFile(archivo);
            Map<String, String> relaciones = leerRelaciones(zip);
            List<String[]> indice = leerIndice(zip, relaciones);
            if (indice.isEmpty()) {
                indice = hojasPorNombre(zip);
            }
            List<Hoja> salida = new ArrayList<Hoja>();
            List<String> cadenas = leerCadenas(zip);
            int limite = Math.min(indice.size(), MAX_HOJAS);
            for (int i = 0; i < limite; i++) {
                String[] par = indice.get(i);
                String ruta = par[1];
                if (ruta == null || ruta.isEmpty() || !existe(zip, ruta)) {
                    continue;
                }
                Hoja hoja = new Hoja();
                hoja.nombre = par[0] == null || par[0].isEmpty() ? ("Hoja " + (i + 1)) : par[0];
                leerHoja(zip, ruta, hoja, cadenas);
                salida.add(hoja);
            }
            if (salida.isEmpty()) {
                throw new IllegalStateException("el libro no tiene hojas legibles");
            }
            return salida;
        } finally {
            if (zip != null) {
                try {
                    zip.close();
                } catch (Throwable ignorado) {
                    // sin más.
                }
            }
        }
    }

    // ------------------------------------------------------------- sharedStrings

    private static List<String> leerCadenas(ZipFile zip) {
        List<String> salida = new ArrayList<String>();
        ZipEntry entrada = zip.getEntry("xl/sharedStrings.xml");
        if (entrada == null) {
            return salida;
        }
        InputStream in = null;
        try {
            in = zip.getInputStream(entrada);
            SAXParser parser = parser();
            parser.parse(in, new CadenasHandler(salida));
        } catch (Throwable t) {
            // Sin cadenas compartidas el libro sigue siendo legible: los
            // textos inline vienen en la hoja.
        } finally {
            cerrar(in);
        }
        return salida;
    }

    private static final class CadenasHandler extends DefaultHandler {
        private final List<String> salida;
        private StringBuilder actual;
        private boolean enTexto;

        CadenasHandler(List<String> salida) {
            this.salida = salida;
        }

        @Override
        public void startElement(String uri, String local, String nombre, Attributes a) {
            if ("si".equals(nombre)) {
                actual = new StringBuilder();
                enTexto = false;
            } else if ("t".equals(nombre)) {
                enTexto = true;
            }
        }

        @Override
        public void characters(char[] ch, int inicio, int largo) {
            if (enTexto && actual != null) {
                actual.append(ch, inicio, largo);
            }
        }

        @Override
        public void endElement(String uri, String local, String nombre) {
            if ("t".equals(nombre)) {
                enTexto = false;
            } else if ("si".equals(nombre)) {
                salida.add(actual == null ? "" : actual.toString());
                actual = null;
                enTexto = false;
            }
        }
    }

    // ---------------------------------------------------------------- workbook

    private static List<String[]> leerIndice(ZipFile zip, Map<String, String> relaciones) {
        List<String[]> salida = new ArrayList<String[]>();
        ZipEntry entrada = zip.getEntry("xl/workbook.xml");
        if (entrada == null) {
            return salida;
        }
        InputStream in = null;
        try {
            in = zip.getInputStream(entrada);
            SAXParser parser = parser();
            parser.parse(in, new IndiceHandler(salida, relaciones));
        } catch (Throwable t) {
            // Se cae al respaldo por nombre de archivo.
        } finally {
            cerrar(in);
        }
        return salida;
    }

    private static final class IndiceHandler extends DefaultHandler {
        private final List<String[]> salida;
        private final Map<String, String> relaciones;

        IndiceHandler(List<String[]> salida, Map<String, String> relaciones) {
            this.salida = salida;
            this.relaciones = relaciones;
        }

        @Override
        public void startElement(String uri, String local, String nombre, Attributes a) {
            if (!"sheet".equals(nombre)) {
                return;
            }
            String titulo = a.getValue("name");
            String rid = a.getValue("r:id");
            if (rid == null) {
                rid = a.getValue("id");
            }
            String destino = rid == null ? "" : relaciones.get(rid);
            if (destino == null) {
                destino = "";
            }
            salida.add(new String[]{titulo, normalizarRuta(destino)});
        }
    }

    private static Map<String, String> leerRelaciones(ZipFile zip) {
        final Map<String, String> salida = new HashMap<String, String>();
        ZipEntry entrada = zip.getEntry("xl/_rels/workbook.xml.rels");
        if (entrada == null) {
            return salida;
        }
        InputStream in = null;
        try {
            in = zip.getInputStream(entrada);
            SAXParser parser = parser();
            parser.parse(in, new DefaultHandler() {
                @Override
                public void startElement(String uri, String local, String nombre, Attributes a) {
                    if (!"Relationship".equals(nombre)) {
                        return;
                    }
                    String id = a.getValue("Id");
                    String target = a.getValue("Target");
                    if (id != null && target != null) {
                        salida.put(id, target);
                    }
                }
            });
        } catch (Throwable t) {
            // sin relaciones: se usa el respaldo por nombre.
        } finally {
            cerrar(in);
        }
        return salida;
    }

    private static List<String[]> hojasPorNombre(ZipFile zip) {
        List<String[]> salida = new ArrayList<String[]>();
        List<String> rutas = new ArrayList<String>();
        Enumeration<? extends ZipEntry> entradas = zip.entries();
        while (entradas.hasMoreElements()) {
            ZipEntry e = entradas.nextElement();
            String n = e.getName();
            if (n != null && n.startsWith("xl/worksheets/") && n.endsWith(".xml")
                    && n.indexOf("/_rels/") < 0) {
                rutas.add(n);
            }
        }
        Collections.sort(rutas, new Comparator<String>() {
            @Override
            public int compare(String a, String b) {
                return numeroHoja(a) - numeroHoja(b);
            }
        });
        for (int i = 0; i < rutas.size(); i++) {
            salida.add(new String[]{"Hoja " + (i + 1), rutas.get(i)});
        }
        return salida;
    }

    private static int numeroHoja(String ruta) {
        try {
            String n = ruta.substring(ruta.lastIndexOf("sheet") + 5);
            int punto = n.indexOf('.');
            if (punto > 0) {
                n = n.substring(0, punto);
            }
            return Integer.parseInt(n);
        } catch (Throwable t) {
            return 9999;
        }
    }

    // -------------------------------------------------------------------- hoja

    private static void leerHoja(ZipFile zip, String ruta, Hoja hoja, List<String> cadenas) {
        InputStream in = null;
        try {
            in = zip.getInputStream(zip.getEntry(ruta));
            SAXParser parser = parser();
            parser.parse(in, new HojaHandler(hoja, cadenas));
        } catch (Throwable t) {
            hoja.truncada = true;
        } finally {
            cerrar(in);
        }
    }

    private static final class HojaHandler extends DefaultHandler {
        private final Hoja hoja;
        private final List<String> cadenas;
        private List<String> fila;
        private int columna = -1;
        private int filaNumero = 0;
        private String tipo = "";
        private StringBuilder valor;
        private StringBuilder inline;
        private boolean enValor;
        private boolean enInline;
        private boolean lleno;

        HojaHandler(Hoja hoja, List<String> cadenas) {
            this.hoja = hoja;
            this.cadenas = cadenas;
        }

        @Override
        public void startElement(String uri, String local, String nombre, Attributes a) {
            if ("row".equals(nombre)) {
                if (lleno) {
                    return;
                }
                if (hoja.filas.size() >= MAX_FILAS) {
                    hoja.truncada = true;
                    lleno = true;
                    return;
                }
                fila = new ArrayList<String>();
                columna = -1;
                String r = a.getValue("r");
                int numero = parseEntero(r, hoja.filas.size() + 1);
                // Rellena filas vacías si el libro salta números.
                while (hoja.filas.size() < numero - 1 && hoja.filas.size() < MAX_FILAS - 1) {
                    hoja.filas.add(new ArrayList<String>());
                }
            } else if ("c".equals(nombre)) {
                if (lleno) {
                    return;
                }
                if (fila == null) {
                    fila = new ArrayList<String>();
                }
                String ref = a.getValue("r");
                if (ref != null && !ref.isEmpty()) {
                    columna = columnaDe(ref);
                } else {
                    columna++;
                }
                tipo = a.getValue("t") == null ? "" : a.getValue("t");
                valor = new StringBuilder();
                inline = new StringBuilder();
                enValor = false;
                enInline = false;
            } else if ("v".equals(nombre)) {
                enValor = true;
            } else if ("t".equals(nombre)) {
                if ("inlineStr".equals(tipo)) {
                    enInline = true;
                }
            }
        }

        @Override
        public void characters(char[] ch, int inicio, int largo) {
            if (enValor && valor != null) {
                valor.append(ch, inicio, largo);
            }
            if (enInline && inline != null) {
                inline.append(ch, inicio, largo);
            }
        }

        @Override
        public void endElement(String uri, String local, String nombre) {
            if ("v".equals(nombre)) {
                enValor = false;
            } else if ("t".equals(nombre)) {
                enInline = false;
            } else if ("c".equals(nombre)) {
                if (fila != null && columna >= 0 && columna < MAX_COLUMNAS) {
                    while (fila.size() <= columna) {
                        fila.add("");
                    }
                    fila.set(columna, resolver());
                }
                valor = null;
                inline = null;
                tipo = "";
            } else if ("row".equals(nombre)) {
                if (fila != null && hoja.filas.size() < MAX_FILAS) {
                    hoja.filas.add(recortar(fila));
                }
                fila = null;
                columna = -1;
            }
        }

        private String resolver() {
            String crudo = valor == null ? "" : valor.toString().trim();
            if ("s".equals(tipo)) {
                try {
                    int i = Integer.parseInt(crudo);
                    return i >= 0 && i < cadenas.size() ? cadenas.get(i) : "";
                } catch (Throwable t) {
                    return "";
                }
            }
            if ("inlineStr".equals(tipo)) {
                return inline == null ? "" : inline.toString().trim();
            }
            if ("b".equals(tipo)) {
                return "1".equals(crudo) ? "1" : "0";
            }
            if ("e".equals(tipo)) {
                return "";
            }
            return crudo;
        }
    }

    private static List<String> recortar(List<String> fila) {
        int fin = fila.size();
        while (fin > 0 && (fila.get(fin - 1) == null || fila.get(fin - 1).trim().isEmpty())) {
            fin--;
        }
        return new ArrayList<String>(fila.subList(0, fin));
    }

    /** "AB12" → 27 (base 0). */
    private static int columnaDe(String ref) {
        int col = 0;
        for (int i = 0; i < ref.length(); i++) {
            char c = ref.charAt(i);
            if (c >= 'A' && c <= 'Z') {
                col = col * 26 + (c - 'A' + 1);
            } else if (c >= 'a' && c <= 'z') {
                col = col * 26 + (c - 'a' + 1);
            } else {
                break;
            }
        }
        return Math.max(0, col - 1);
    }

    private static int parseEntero(String s, int respaldo) {
        try {
            return Integer.parseInt(String.valueOf(s).trim());
        } catch (Throwable t) {
            return respaldo;
        }
    }

    private static boolean existe(ZipFile zip, String ruta) {
        return zip.getEntry(ruta) != null;
    }

    private static String normalizarRuta(String destino) {
        if (destino == null) {
            return "";
        }
        String d = destino.replace('\\', '/');
        while (d.startsWith("/")) {
            d = d.substring(1);
        }
        if (d.isEmpty()) {
            return "";
        }
        if (d.startsWith("xl/")) {
            return d;
        }
        return "xl/" + d;
    }

    private static SAXParser parser() throws Exception {
        SAXParserFactory f = SAXParserFactory.newInstance();
        f.setNamespaceAware(false);
        f.setValidating(false);
        try {
            f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        } catch (Throwable ignorado) {
            // Algunos parsers de Android no exponen esta feature.
        }
        try {
            f.setFeature("http://xml.org/sax/features/external-general-entities", false);
            f.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        } catch (Throwable ignorado) {
            // sin más.
        }
        return f.newSAXParser();
    }

    private static void cerrar(InputStream in) {
        if (in == null) {
            return;
        }
        try {
            in.close();
        } catch (Throwable ignorado) {
            // sin más.
        }
    }
}
