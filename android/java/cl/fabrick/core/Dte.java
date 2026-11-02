package cl.fabrick.core;

import java.io.ByteArrayInputStream;
import java.io.StringReader;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.charset.Charset;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.security.interfaces.RSAPublicKey;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;

import org.json.JSONArray;
import org.json.JSONObject;
import org.w3c.dom.Document;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.ErrorHandler;
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;
import org.xml.sax.SAXParseException;

/**
 * Emisión local de DTE chilenos (boleta, factura, notas y exenta).
 *
 * <p>Todo ocurre en el teléfono: se lee el certificado PKCS12 del usuario, se
 * interpreta el CAF que entregó el SII, se arma el XML del documento y se firma
 * con {@code java.security} + {@code javax.crypto}. No hay red, no hay archivos
 * temporales, no hay servicios externos y no se guarda nada: la app decide qué
 * persiste (folios, documentos emitidos, respaldos).
 *
 * <p><b>Esto es una implementación de referencia, no un emisor certificado.</b>
 * Para que estos XML sean aceptados por el SII faltan piezas que este archivo no
 * puede inventar:
 *
 * <ul>
 *   <li><b>Certificado real</b>: firma electrónica avanzada vigente del
 *       contribuyente, en PKCS12 (.p12/.pfx), con su clave privada. El
 *       certificado de prueba del SII sólo sirve para el ambiente de
 *       certificación.</li>
 *   <li><b>CAF autorizado</b>: el archivo que el SII entrega por contribuyente
 *       y tipo de documento, con el rango de folios y la firma del SII. Sin CAF
 *       no hay folio legal: el número que se use no existe para el SII.</li>
 *   <li><b>Certificación / afiliación</b>: el SII exige pasar por su ambiente de
 *       certificación (validación contra los esquemas XSD, set de pruebas,
 *       revisión de la firma) antes de aceptar documentos en producción. Un XML
 *       bien formado no basta.</li>
 *   <li><b>Canonicalización exacta</b>: aquí se canoniza de forma mínima (se
 *       firman los bytes tal como se generan, sin reordenar atributos ni
 *       normalizar espacios). La certificación exige que el XMLDSig valide con
 *       un procesador C14N real; cualquier herramienta que reindente o reordene
 *       el documento invalida el digest.</li>
 *   <li><b>PDF417 del TED</b>: el timbre electrónico que se imprime en el
 *       documento tributario es un código de barras PDF417 generado a partir del
 *       TED. Aquí se entrega el TED en XML firmado, no la imagen ni el código de
 *       barras.</li>
 *   <li><b>Envío</b>: falta el sobre {@code EnvioDTE}/{@code EnvioBOLETA}, su
 *       propia firma, la carátula y el canal de subida al SII.</li>
 * </ul>
 *
 * <p>Con esas piezas fuera, esta clase sirve para previsualizar, validar datos,
 * imprimir borradores y preparar el terreno; <b>no emite documentos válidos</b>.
 *
 * <p>Reglas de la clase, iguales a las del resto del puente:
 * <ul>
 *   <li>Todo es {@code static} y devuelve una cadena JSON.</li>
 *   <li>Nunca lanza excepción: cualquier fallo se convierte en
 *       {@code {"ok":false,"error":"..."}}.</li>
 *   <li>No escribe en disco, no imprime en consola, no abre sockets.</li>
 * </ul>
 *
 * <p>La base64 se implementa aquí mismo para que la clase compile y se pueda
 * probar en una JVM de escritorio sin Android (el proyecto compila con
 * {@code javac -source 1.8}).
 */
public final class Dte {

    /** Namespace de XMLDSig. */
    private static final String NS_DSIG = "http://www.w3.org/2000/09/xmldsig#";
    /** Canonicalización que declara el documento (ver la nota de cabecera). */
    private static final String C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
    /** Algoritmo de la firma del DTE y del TED: RSA con SHA-1, como pide el SII. */
    private static final String RSA_SHA1 = NS_DSIG + "rsa-sha1";
    /** Algoritmo de la firma suelta de {@link #firmar}. */
    private static final String RSA_SHA256 = "SHA256withRSA";
    /** Nombre JCA del SHA-1 con RSA que usa el SII en el TED y en el XMLDSig. */
    private static final String RSA_SHA1_JCA = "SHA1withRSA";

    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final char[] B64 =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toCharArray();

    /** Tipos que este motor entiende. */
    private static final int BOLETA = 39;
    private static final int FACTURA = 33;
    private static final int NOTA_CREDITO = 61;
    private static final int NOTA_DEBITO = 56;
    private static final int BOLETA_EXENTA = 41;

    private Dte() {
        // Sólo métodos estáticos: no hay estado que guardar.
    }

    // --------------------------------------------------------------- diagnóstico

    /**
     * Prueba de vida del motor. Sirve para que la interfaz sepa si la clase
     * existe en esta compilación antes de mostrar el módulo de documentos.
     */
    public static String estado() {
        try {
            JSONObject r = new JSONObject();
            r.put("ok", true);
            r.put("motor", "dte-local");
            r.put("version", "1");
            r.put("firma", RSA_SHA256);
            r.put("ted", RSA_SHA1_JCA);
            r.put("tipos", "39,33,61,56,41");
            return r.toString();
        } catch (Throwable t) {
            return fallo(mensaje(t));
        }
    }

    // ------------------------------------------------------------- certificado

    /**
     * Lee un PKCS12 y devuelve los datos que la interfaz necesita para mostrar
     * "certificado cargado" sin exponer la clave privada.
     *
     * <p>El RUT se busca en {@code SERIALNUMBER} (donde lo pone la mayoría de las
     * certificadoras chilenas) y, si no está, en {@code CN}; se aceptan formatos
     * con puntos ({@code 12.345.678-9}) y sin ellos.
     *
     * <p>{@code dias} son los días completos que faltan para {@code notAfter};
     * es negativo si el certificado ya venció y 0 si vence hoy.
     */
    public static String certificadoInfo(byte[] p12, String clave) {
        try {
            Material m = cargar(p12, clave);
            X509Certificate c = m.certificado;
            if (c == null) {
                return fallo("el PKCS12 no contiene un certificado X.509 utilizable");
            }
            String dn = c.getSubjectX500Principal().getName();
            String nombre = atributo(dn, "CN");
            String rut = rutDe(atributo(dn, "SERIALNUMBER"));
            if (rut.isEmpty()) {
                rut = rutDe(nombre);
            }
            if (rut.isEmpty()) {
                rut = rutDe(dn);
            }

            String emisor = atributo(c.getIssuerX500Principal().getName(), "CN");
            if (emisor.isEmpty()) {
                emisor = c.getIssuerX500Principal().getName();
            }

            long faltan = (c.getNotAfter().getTime() - System.currentTimeMillis()) / 86400000L;
            boolean vigente = true;
            try {
                c.checkValidity();
            } catch (Throwable vencido) {
                vigente = false;
            }

            JSONObject r = new JSONObject();
            r.put("ok", true);
            r.put("rut", rut);
            r.put("nombre", nombre);
            r.put("emisor", emisor);
            r.put("vence", fecha(c.getNotAfter()));
            r.put("dias", faltan);
            r.put("vigente", vigente);
            r.put("alias", m.alias);
            r.put("error", "");
            return r.toString();
        } catch (Throwable t) {
            return fallo(motivoCertificado(t));
        }
    }

    // --------------------------------------------------------------------- CAF

    /**
     * Interpreta el XML del CAF que entrega el SII.
     *
     * <p>El parser va con DTD deshabilitado y sin entidades externas: el CAF
     * llega como archivo del usuario y no puede convertirse en una vía para leer
     * archivos del teléfono (XXE).
     *
     * <p>{@code tipo} se devuelve numérico, que es lo que usa el resto del
     * sistema; {@code tipoNombre} queda para mostrar en pantalla.
     */
    public static String cafInfo(String xml) {
        try {
            if (xml == null || xml.trim().isEmpty()) {
                return fallo("el CAF está vacío");
            }
            if (xml.length() > 2000000) {
                return fallo("el CAF es demasiado grande para ser un archivo del SII");
            }
            Document doc = parsear(xml);
            if (doc == null || doc.getDocumentElement() == null) {
                return fallo("el CAF no tiene elemento raíz");
            }

            int tipo = entero(texto(doc, "TD"), -1);
            if (tipo < 0) {
                return fallo("el CAF no declara <TD> (tipo de documento)");
            }
            int desde = entero(texto(doc, "D"), -1);
            int hasta = entero(texto(doc, "H"), -1);
            if (desde < 0 || hasta < 0 || hasta < desde) {
                return fallo("el CAF no declara un rango <RNG><D>/<H> válido");
            }

            String rut = rutLimpio(texto(doc, "RE"));
            if (rut.isEmpty()) {
                rut = texto(doc, "RE");
            }
            boolean tieneClave = !texto(doc, "M").isEmpty() && !texto(doc, "E").isEmpty();

            JSONObject r = new JSONObject();
            r.put("ok", true);
            r.put("tipo", tipo);
            r.put("tipoNombre", nombreTipo(tipo));
            r.put("desde", desde);
            r.put("hasta", hasta);
            r.put("fecha", texto(doc, "FA"));
            r.put("rut", rut);
            r.put("razon", texto(doc, "RS"));
            r.put("tieneClave", tieneClave);
            r.put("error", "");
            return r.toString();
        } catch (Throwable t) {
            return fallo(mensaje(t));
        }
    }

    /**
     * Primer folio disponible del rango del CAF.
     *
     * <p>No persiste nada: el CAF sólo dice qué rango fue autorizado, no cuál
     * fue el último folio usado. La app guarda el consecutivo en su base y usa
     * {@link #folioSiguiente(String, int)} para pedir el siguiente.
     */
    public static String folioSiguiente(String cafXml) {
        return folioSiguiente(cafXml, 0);
    }

    /**
     * Siguiente folio del CAF después de {@code ultimoUsado}.
     *
     * <p>Si {@code ultimoUsado} es 0 (o menor que el rango) devuelve {@code D};
     * si el rango se agotó responde {@code ok:false} con {@code agotado:true}
     * para que la interfaz pida un CAF nuevo en vez de seguir emitiendo.
     */
    public static String folioSiguiente(String cafXml, int ultimoUsado) {
        try {
            if (cafXml == null || cafXml.trim().isEmpty()) {
                return fallo("el CAF está vacío");
            }
            Document doc = parsear(cafXml);
            if (doc == null || doc.getDocumentElement() == null) {
                return fallo("el CAF no tiene elemento raíz");
            }
            int tipo = entero(texto(doc, "TD"), -1);
            int desde = entero(texto(doc, "D"), -1);
            int hasta = entero(texto(doc, "H"), -1);
            if (tipo < 0) {
                return fallo("el CAF no declara <TD> (tipo de documento)");
            }
            if (desde < 1 || hasta < desde) {
                return fallo("el CAF no declara un rango de folios válido");
            }

            int folio = Math.max(desde, ultimoUsado + 1);
            JSONObject r = new JSONObject();
            r.put("tipo", tipo);
            r.put("tipoNombre", nombreTipo(tipo));
            r.put("desde", desde);
            r.put("hasta", hasta);
            if (folio > hasta) {
                r.put("ok", false);
                r.put("agotado", true);
                r.put("folio", hasta);
                r.put("restantes", 0);
                r.put("error", "se agotaron los folios del CAF (" + desde + "-" + hasta + ")");
                return r.toString();
            }
            r.put("ok", true);
            r.put("agotado", false);
            r.put("folio", folio);
            r.put("restantes", hasta - folio + 1);
            r.put("error", "");
            return r.toString();
        } catch (Throwable t) {
            return fallo(mensaje(t));
        }
    }

    // ------------------------------------------------------------------- firma

    /**
     * Firma un texto suelto con la clave privada del certificado (SHA-256 con
     * RSA). Devuelve la firma en base64 para que la app la guarde junto al
     * documento sin tocar la clave.
     */
    public static String firmar(String texto, byte[] p12, String clave) {
        try {
            if (texto == null) {
                return fallo("no hay nada que firmar");
            }
            Material m = cargar(p12, clave);
            if (m.clave == null) {
                return fallo("el certificado no trae una clave privada utilizable");
            }
            byte[] firma = firmarBytes(m.clave, RSA_SHA256, texto.getBytes(UTF8));

            JSONObject r = new JSONObject();
            r.put("ok", true);
            r.put("firma", base64(firma));
            r.put("algoritmo", RSA_SHA256);
            r.put("error", "");
            return r.toString();
        } catch (Throwable t) {
            return fallo(motivoCertificado(t));
        }
    }

    // -------------------------------------------------------------------- DTE

    /**
     * Construye y firma un DTE mínimo.
     *
     * <p>Forma esperada de {@code datos} (los campos planos también se aceptan
     * como respaldo: {@code rutEmisor}, {@code razonEmisor}, etc.):
     *
     * <pre>
     * {
     *   "tipo": 39,                      // 39 bol, 33 fact, 61 NC, 56 ND, 41 exenta
     *   "folio": 123,
     *   "fecha": "2026-11-02",           // opcional; si falta, hoy
     *   "emisor":   {"rut":"76123456-7","razon":"...","giro":"...",
     *                "acteco":620100,"direccion":"...","comuna":"..."},
     *   "receptor": {"rut":"12345678-9","razon":"..."},
     *   "items": [{"nombre":"...","cantidad":2,"precio":10000}],  // precio NETO
     *   "total": 23800                   // bruto; si falta se calcula de los ítems
     * }
     * </pre>
     *
     * <p>El neto y el IVA se calculan desde el total bruto:
     * {@code neto = round(total / 1.19)} e {@code iva = total - neto}, para que
     * la suma cuadre al peso. En la boleta exenta (41) no se emite IVA: el total
     * va como {@code MntExe}. Los precios de los ítems se interpretan como netos;
     * si no suman el neto, el XML igual se genera y se avisa en {@code aviso}.
     *
     * <p>Si faltan {@code giro}, {@code acteco}, {@code direccion} o
     * {@code comuna} se usan marcadores ("Sin giro", 0, "Sin direccion",
     * "Sin comuna") para que el XML quede bien formado, pero un documento real
     * los necesita: son datos obligatorios del emisor.
     *
     * <p>El TED se firma con SHA-1 con RSA (es lo que el SII espera en el timbre)
     * y el documento lleva un {@code <Signature>} XMLDSig "enveloped"
     * simplificado: el digest es SHA-1 de la serialización exacta del
     * {@code <Documento>} y el {@code SignatureValue} es RSA-SHA1 del
     * {@code SignedInfo}. <b>Es una implementación de referencia</b>: la
     * certificación con el SII exige validar con un procesador C14N real que el
     * digest coincida después de canonicalizar, y que el XML valide contra los
     * esquemas oficiales. Aquí no se reindenta ni se reordena nada, justamente
     * para que el digest sea reproducible.
     *
     * <p>Cuidado con la codificación: el TED se firma sobre los bytes UTF-8 del
     * {@code DD}. Si la app convierte el documento a ISO-8859-1 para enviarlo
     * (el SII históricamente lo pide así), tiene que volver a firmar el TED
     * sobre los bytes ya convertidos; una firma calculada antes de la conversión
     * deja de cuadrar en cuanto haya acentos.
     *
     * <p>El XML se declara UTF-8: hay que escribirlo como UTF-8. Convertirlo a
     * ISO-8859-1 sin cambiar la declaración produce un archivo inválido.
     */
    public static String dteXml(JSONObject datos, byte[] p12, String clave) {
        try {
            if (datos == null) {
                return fallo("faltan los datos del documento");
            }
            Material m = cargar(p12, clave);
            if (m.clave == null) {
                return fallo("el certificado no trae una clave privada utilizable");
            }

            int tipo = (int) numero(datos, "tipo", BOLETA);
            if (tipo != BOLETA && tipo != FACTURA && tipo != NOTA_CREDITO
                    && tipo != NOTA_DEBITO && tipo != BOLETA_EXENTA) {
                return fallo("tipo de documento no soportado: " + tipo
                        + " (usa 39, 33, 61, 56 o 41)");
            }

            long folio = (long) numero(datos, "folio", 0);
            if (folio < 1) {
                return fallo("falta el folio del documento");
            }

            String fecha = fechaValida(campo(datos, "fecha", "FchEmis"));
            if (fecha.isEmpty()) {
                fecha = fecha(new Date());
            }

            JSONObject emisor = objeto(datos, "emisor", "Emisor");
            JSONObject receptor = objeto(datos, "receptor", "Receptor");

            String rutEmisor = rutLimpio(campo(emisor, "rut", "RUTEmisor"));
            if (rutEmisor.isEmpty()) {
                rutEmisor = rutLimpio(campo(datos, "rutEmisor", "RUTEmisor"));
            }
            if (!rutValido(rutEmisor)) {
                return fallo("falta el RUT del emisor (formato 12345678-9)");
            }

            String razonEmisor = campo(emisor, "razon", "razonSocial", "RznSoc");
            if (razonEmisor.isEmpty()) {
                razonEmisor = campo(datos, "razonEmisor");
            }
            if (razonEmisor.isEmpty()) {
                return fallo("falta la razón social del emisor");
            }

            String giro = campo(emisor, "giro", "GiroEmis");
            if (giro.isEmpty()) {
                giro = "Sin giro";
            }
            long acteco = (long) numero(emisor, "acteco", 0);
            String direccion = campo(emisor, "direccion", "DirOrigen");
            if (direccion.isEmpty()) {
                direccion = "Sin direccion";
            }
            String comuna = campo(emisor, "comuna", "CmnaOrigen");
            if (comuna.isEmpty()) {
                comuna = "Sin comuna";
            }

            String rutRecep = rutLimpio(campo(receptor, "rut", "RUTRecep"));
            String razonRecep = campo(receptor, "razon", "razonSocial", "RznSocRecep");
            boolean consumidorFinal = tipo == BOLETA || tipo == BOLETA_EXENTA;
            if (rutRecep.isEmpty() && consumidorFinal) {
                // Convención del SII para boletas sin identificar al comprador.
                rutRecep = "66666666-6";
            }
            if (razonRecep.isEmpty() && consumidorFinal) {
                razonRecep = "Consumidor final";
            }
            if (!rutValido(rutRecep)) {
                return fallo("falta el RUT del receptor (formato 12345678-9)");
            }
            if (razonRecep.isEmpty()) {
                return fallo("falta la razón social del receptor");
            }

            // Ítems: se leen antes de calcular para poder repartir el neto.
            List<String> nombres = new ArrayList<String>();
            List<Double> cantidades = new ArrayList<Double>();
            List<Double> precios = new ArrayList<Double>();
            leerItems(datos, nombres, cantidades, precios);
            if (nombres.isEmpty()) {
                nombres.add("Venta");
                cantidades.add(1.0);
                precios.add(0.0);
            }

            long total;
            long neto;
            long iva;
            double totalPedido = numero(datos, "total", -1);
            boolean exenta = tipo == BOLETA_EXENTA;

            if (totalPedido > 0) {
                total = Math.round(totalPedido);
                if (exenta) {
                    neto = 0;
                    iva = 0;
                } else {
                    neto = Math.round(total * 100.0 / 119.0);
                    iva = total - neto;
                }
            } else {
                double suma = 0;
                for (int i = 0; i < nombres.size(); i++) {
                    suma += cantidades.get(i) * precios.get(i);
                }
                if (suma <= 0) {
                    return fallo("falta el total o los precios de los ítems");
                }
                neto = exenta ? 0 : Math.round(suma);
                if (exenta) {
                    total = Math.round(suma);
                    iva = 0;
                } else {
                    iva = Math.round(neto * 0.19d);
                    total = neto + iva;
                }
            }
            long baseDetalle = exenta ? total : neto;

            // ¿Los precios vienen informados o hay que repartir el neto?
            boolean derivar = true;
            for (int i = 0; i < precios.size(); i++) {
                if (precios.get(i) > 0) {
                    derivar = false;
                    break;
                }
            }

            double[] prcs = new double[nombres.size()];
            long[] montos = new long[nombres.size()];
            if (derivar) {
                double qTotal = 0;
                for (int i = 0; i < cantidades.size(); i++) {
                    qTotal += cantidades.get(i);
                }
                if (qTotal <= 0) {
                    cantidades.set(0, 1.0);
                    qTotal = 1.0;
                }
                long repartido = 0;
                for (int i = 0; i < nombres.size(); i++) {
                    long parte = Math.round((double) baseDetalle * cantidades.get(i) / qTotal);
                    if (i == nombres.size() - 1) {
                        // El último absorbe el redondeo: la suma debe dar exacto.
                        parte = baseDetalle - repartido;
                    }
                    repartido += parte;
                    montos[i] = parte;
                    prcs[i] = cantidades.get(i) > 0 ? parte / cantidades.get(i) : 0;
                }
            } else {
                for (int i = 0; i < nombres.size(); i++) {
                    prcs[i] = precios.get(i);
                    montos[i] = Math.round(cantidades.get(i) * prcs[i]);
                }
            }

            long sumaMontos = 0;
            for (int i = 0; i < montos.length; i++) {
                sumaMontos += montos[i];
            }
            String aviso = "";
            if (sumaMontos != baseDetalle) {
                aviso = "el detalle suma " + sumaMontos + " y el neto es "
                        + baseDetalle + "; revisa los precios de los ítems";
            }

            // --- Detalle -------------------------------------------------
            StringBuilder detalle = new StringBuilder();
            for (int i = 0; i < nombres.size(); i++) {
                detalle.append("<Detalle><NroLinDet>").append(i + 1).append("</NroLinDet>")
                        .append("<NmbItem>").append(esc(nombres.get(i))).append("</NmbItem>")
                        .append("<QtyItem>").append(numero(cantidades.get(i))).append("</QtyItem>")
                        .append("<PrcItem>").append(numero(prcs[i])).append("</PrcItem>")
                        .append("<MontoItem>").append(montos[i]).append("</MontoItem>")
                        .append("</Detalle>");
            }

            // --- Totales -------------------------------------------------
            StringBuilder totales = new StringBuilder("<Totales>");
            if (exenta) {
                totales.append("<MntExe>").append(total).append("</MntExe>");
            } else {
                totales.append("<MntNeto>").append(neto).append("</MntNeto>")
                        .append("<TasaIVA>19</TasaIVA>")
                        .append("<IVA>").append(iva).append("</IVA>");
            }
            totales.append("<MntTotal>").append(total).append("</MntTotal></Totales>");

            // --- Timbre (TED): el DD se firma con la clave del emisor ----
            String dd = "<DD><RE>" + esc(rutEmisor) + "</RE>"
                    + "<TD>" + tipo + "</TD>"
                    + "<F>" + folio + "</F>"
                    + "<FE>" + fecha + "</FE>"
                    + "<RR>" + esc(rutRecep) + "</RR>"
                    + "<RSR>" + esc(razonRecep) + "</RSR>"
                    + "<MNT>" + total + "</MNT></DD>";
            String frmt = base64(firmarBytes(m.clave, RSA_SHA1_JCA, dd.getBytes(UTF8)));
            String ted = "<TED version=\"1.0\">" + dd
                    + "<FRMT algoritmo=\"SHA1withRSA\">" + frmt + "</FRMT></TED>";

            // --- Documento -----------------------------------------------
            String id = "F" + folio + "T" + tipo;
            StringBuilder doc = new StringBuilder(1024);
            doc.append("<Documento ID=\"").append(id).append("\">")
                    .append("<Encabezado><IdDoc>")
                    .append("<TipoDTE>").append(tipo).append("</TipoDTE>")
                    .append("<Folio>").append(folio).append("</Folio>")
                    .append("<FchEmis>").append(fecha).append("</FchEmis>")
                    .append("</IdDoc><Emisor>")
                    .append("<RUTEmisor>").append(esc(rutEmisor)).append("</RUTEmisor>")
                    .append("<RznSoc>").append(esc(razonEmisor)).append("</RznSoc>")
                    .append("<GiroEmis>").append(esc(giro)).append("</GiroEmis>")
                    .append("<Acteco>").append(acteco).append("</Acteco>")
                    .append("<DirOrigen>").append(esc(direccion)).append("</DirOrigen>")
                    .append("<CmnaOrigen>").append(esc(comuna)).append("</CmnaOrigen>")
                    .append("</Emisor><Receptor>")
                    .append("<RUTRecep>").append(esc(rutRecep)).append("</RUTRecep>")
                    .append("<RznSocRecep>").append(esc(razonRecep)).append("</RznSocRecep>")
                    .append("</Receptor>")
                    .append(totales)
                    .append("</Encabezado>")
                    .append(detalle)
                    .append(ted)
                    .append("<TmstFirma>").append(ahora()).append("</TmstFirma>")
                    .append("</Documento>");
            String documento = doc.toString();

            // --- Firma XMLDSig "enveloped" (ver nota de la cabecera) -----
            String digest = base64(sha1(documento.getBytes(UTF8)));
            String signedInfo = "<SignedInfo xmlns=\"" + NS_DSIG + "\">"
                    + "<CanonicalizationMethod Algorithm=\"" + C14N + "\"></CanonicalizationMethod>"
                    + "<SignatureMethod Algorithm=\"" + RSA_SHA1 + "\"></SignatureMethod>"
                    + "<Reference URI=\"#" + id + "\">"
                    + "<Transforms><Transform Algorithm=\"" + NS_DSIG + "enveloped-signature\">"
                    + "</Transform></Transforms>"
                    + "<DigestMethod Algorithm=\"" + NS_DSIG + "sha1\"></DigestMethod>"
                    + "<DigestValue>" + digest + "</DigestValue>"
                    + "</Reference></SignedInfo>";
            String firmaDocumento = base64(firmarBytes(m.clave, RSA_SHA1_JCA,
                    signedInfo.getBytes(UTF8)));
            String signature = "<Signature xmlns=\"" + NS_DSIG + "\">" + signedInfo
                    + "<SignatureValue>" + firmaDocumento + "</SignatureValue>"
                    + keyInfo(m.certificado)
                    + "</Signature>";

            String xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                    + "<DTE version=\"1.0\">" + documento + signature + "</DTE>";

            JSONObject r = new JSONObject();
            r.put("ok", true);
            r.put("xml", xml);
            r.put("folio", folio);
            r.put("tipo", tipo);
            r.put("total", total);
            r.put("neto", neto);
            r.put("iva", iva);
            r.put("ted", ted);
            r.put("error", "");
            if (!aviso.isEmpty()) {
                r.put("aviso", aviso);
            }
            return r.toString();
        } catch (Throwable t) {
            return fallo(motivoCertificado(t));
        }
    }

    // ----------------------------------------------------------- certificado

    /** Lo que se necesita de un PKCS12 ya abierto. */
    private static final class Material {
        final PrivateKey clave;
        final X509Certificate certificado;
        final String alias;

        Material(PrivateKey clave, X509Certificate certificado, String alias) {
            this.clave = clave;
            this.certificado = certificado;
            this.alias = alias;
        }
    }

    /**
     * Abre el PKCS12 y elige la primera entrada con clave y certificado.
     *
     * <p>Si la clave viene nula se prueban también la contraseña vacía: hay
     * archivos exportados sin contraseña que igual piden un arreglo vacío en
     * algunas implementaciones de PKCS12.
     */
    private static Material cargar(byte[] p12, String clave) throws Exception {
        if (p12 == null || p12.length == 0) {
            throw new IllegalArgumentException("falta el certificado PKCS12 (.p12/.pfx)");
        }
        KeyStore ks = KeyStore.getInstance("PKCS12");
        char[] usado = null;
        Throwable ultimo = null;

        char[][] intentos;
        if (clave == null) {
            intentos = new char[][] { null, new char[0] };
        } else {
            intentos = new char[][] { clave.toCharArray() };
        }

        for (int i = 0; i < intentos.length; i++) {
            try {
                ks.load(new ByteArrayInputStream(p12), intentos[i]);
                usado = intentos[i];
                ultimo = null;
                break;
            } catch (Throwable t) {
                ultimo = t;
            }
        }
        if (ultimo != null) {
            if (ultimo instanceof Exception) {
                throw (Exception) ultimo;
            }
            throw new IllegalArgumentException(mensaje(ultimo));
        }

        String alias = null;
        Enumeration<String> nombres = ks.aliases();
        while (nombres.hasMoreElements()) {
            String a = nombres.nextElement();
            if (ks.isKeyEntry(a) && ks.getCertificate(a) != null) {
                alias = a;
                break;
            }
        }
        if (alias == null) {
            nombres = ks.aliases();
            while (nombres.hasMoreElements()) {
                String a = nombres.nextElement();
                if (ks.getCertificate(a) instanceof X509Certificate) {
                    alias = a;
                    break;
                }
            }
        }
        if (alias == null) {
            throw new IllegalArgumentException("el PKCS12 no contiene certificados");
        }

        X509Certificate cert = null;
        Certificate directo = ks.getCertificate(alias);
        if (directo instanceof X509Certificate) {
            cert = (X509Certificate) directo;
        }
        if (cert == null) {
            Certificate[] cadena = ks.getCertificateChain(alias);
            if (cadena != null) {
                for (int i = 0; i < cadena.length; i++) {
                    if (cadena[i] instanceof X509Certificate) {
                        cert = (X509Certificate) cadena[i];
                        break;
                    }
                }
            }
        }

        PrivateKey pk = null;
        try {
            pk = (PrivateKey) ks.getKey(alias, usado);
        } catch (Throwable ignorado) {
            // Sin clave privada no se puede firmar; se informa al llamador.
        }
        return new Material(pk, cert, alias);
    }

    /** Firma bytes con la clave privada. */
    private static byte[] firmarBytes(PrivateKey clave, String algoritmo, byte[] datos)
            throws Exception {
        Cipher c = Cipher.getInstance(algoritmo);
        c.init(Cipher.ENCRYPT_MODE, clave);
        return c.doFinal(datos);
    }

    /** Bloque KeyInfo con la clave pública RSA y el certificado del emisor. */
    private static String keyInfo(X509Certificate cert) {
        String dentro = "";
        try {
            if (cert != null) {
                StringBuilder sb = new StringBuilder();
                PublicKey pub = cert.getPublicKey();
                if (pub instanceof RSAPublicKey) {
                    RSAPublicKey rsa = (RSAPublicKey) pub;
                    sb.append("<KeyValue><RSAKeyValue><Modulus>")
                            .append(base64(sinCero(rsa.getModulus())))
                            .append("</Modulus><Exponent>")
                            .append(base64(sinCero(rsa.getPublicExponent())))
                            .append("</Exponent></RSAKeyValue></KeyValue>");
                }
                sb.append("<X509Data><X509Certificate>")
                        .append(base64(cert.getEncoded()))
                        .append("</X509Certificate></X509Data>");
                dentro = sb.toString();
            }
        } catch (Throwable ignorado) {
            // El KeyInfo es una ayuda para verificar: si falla, la firma sigue.
            dentro = "";
        }
        return "<KeyInfo>" + dentro + "</KeyInfo>";
    }

    /** Un BigInteger con signo puede traer un 0x00 delante; RSA no lo quiere. */
    private static byte[] sinCero(BigInteger n) {
        byte[] b = n.toByteArray();
        if (b.length > 1 && b[0] == 0) {
            return Arrays.copyOfRange(b, 1, b.length);
        }
        return b;
    }

    // ------------------------------------------------------------ XML y fechas

    /**
     * Parser endurecido: sin DTD, sin entidades externas y sin acceso a
     * esquemas. Un CAF es un archivo que llega de afuera; no puede convertirse
     * en una lectura arbitraria del teléfono.
     */
    private static Document parsear(String xml) throws Exception {
        if (xml == null || xml.trim().isEmpty()) {
            throw new IllegalArgumentException("el XML está vacío");
        }
        if (xml.length() > 2000000) {
            throw new IllegalArgumentException("el XML es demasiado grande para ser un CAF");
        }
        // Candado adicional, independiente del parser: un CAF legítimo no trae
        // DTD. Se rechaza antes de construir el documento, así ninguna versión
        // de Android puede resolver una entidad externa.
        String mayusculas = xml.toUpperCase(Locale.ROOT);
        if (mayusculas.contains("<!DOCTYPE") || mayusculas.contains("<!ENTITY")) {
            throw new IllegalArgumentException(
                    "el XML trae un DTD; un CAF del SII no lo necesita");
        }

        DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
        f.setNamespaceAware(false);
        f.setValidating(false);
        f.setExpandEntityReferences(false);
        try {
            f.setXIncludeAware(false);
        } catch (Throwable ignorado) {
            // Parsers viejos no lo soportan; el resto de los candados basta.
        }
        try {
            f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        } catch (Throwable ignorado) {
            // Se compensa con el EntityResolver vacío de abajo.
        }
        try {
            f.setFeature("http://xml.org/sax/features/external-general-entities", false);
        } catch (Throwable ignorado) {
            // Igual: sin resolución de entidades.
        }
        try {
            f.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        } catch (Throwable ignorado) {
            // Igual.
        }
        try {
            f.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
        } catch (Throwable ignorado) {
            // Igual.
        }
        try {
            f.setAttribute("http://javax.xml.XMLConstants/property/accessExternalDTD", "");
        } catch (Throwable ignorado) {
            // El atributo es opcional en la implementación.
        }
        try {
            f.setAttribute("http://javax.xml.XMLConstants/property/accessExternalSchema", "");
        } catch (Throwable ignorado) {
            // Igual.
        }

        DocumentBuilder b = f.newDocumentBuilder();
        b.setEntityResolver(new org.xml.sax.EntityResolver() {
            @Override
            public InputSource resolveEntity(String publicId, String systemId) {
                return new InputSource(new StringReader(""));
            }
        });
        b.setErrorHandler(new ErrorHandler() {
            @Override
            public void warning(SAXParseException e) {
                // Un CAF real no debería generar avisos; se ignoran.
            }

            @Override
            public void error(SAXParseException e) {
                // Los errores no fatales se dejan pasar: el SII agrega ruido.
            }

            @Override
            public void fatalError(SAXParseException e) throws SAXException {
                throw e;
            }
        });
        return b.parse(new InputSource(new StringReader(xml)));
    }

    /**
     * Texto del primer elemento con ese nombre local, sin importar el prefijo
     * de namespace. Se recorre a mano porque {@code getElementsByTagName} no
     * encuentra {@code <ns:TD>} cuando el parser no es namespace-aware.
     */
    private static String texto(Document doc, String etiqueta) {
        if (doc == null || etiqueta == null) {
            return "";
        }
        NodeList todos = doc.getElementsByTagName("*");
        for (int i = 0; i < todos.getLength(); i++) {
            Node n = todos.item(i);
            if (n.getNodeType() != Node.ELEMENT_NODE) {
                continue;
            }
            String nombre = n.getNodeName();
            int dosPuntos = nombre.indexOf(':');
            String local = dosPuntos >= 0 ? nombre.substring(dosPuntos + 1) : nombre;
            if (!local.equalsIgnoreCase(etiqueta)) {
                continue;
            }
            String valor = n.getTextContent();
            if (valor != null && !valor.trim().isEmpty()) {
                return valor.trim();
            }
        }
        return "";
    }

    /** Escapa el texto para XML y descarta los controles que XML no admite. */
    private static String esc(String s) {
        if (s == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            switch (ch) {
                case '&':
                    sb.append("&amp;");
                    break;
                case '<':
                    sb.append("&lt;");
                    break;
                case '>':
                    sb.append("&gt;");
                    break;
                case '"':
                    sb.append("&quot;");
                    break;
                case '\'':
                    sb.append("&apos;");
                    break;
                default:
                    if (ch == '\t' || ch == '\n' || ch == '\r') {
                        sb.append(' ');
                    } else if (ch >= 0x20 && ch != 0x7F) {
                        sb.append(ch);
                    }
                    // El resto son controles inválidos en XML: se descartan.
            }
        }
        return sb.toString();
    }

    /** Número para el XML: entero cuando lo es, decimal con punto cuando no. */
    private static String numero(double v) {
        if (Math.abs(v - Math.rint(v)) < 0.0000001) {
            return String.valueOf((long) Math.rint(v));
        }
        return BigDecimal.valueOf(v).stripTrailingZeros().toPlainString();
    }

    private static String fecha(Date d) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(d);
    }

    private static String ahora() {
        return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.ROOT).format(new Date());
    }

    private static String fechaValida(String texto) {
        if (texto == null) {
            return "";
        }
        String s = texto.trim();
        return s.matches("\\d{4}-\\d{2}-\\d{2}") ? s : "";
    }

    private static String nombreTipo(int tipo) {
        switch (tipo) {
            case BOLETA:
                return "Boleta electrónica";
            case FACTURA:
                return "Factura electrónica";
            case NOTA_CREDITO:
                return "Nota de crédito electrónica";
            case NOTA_DEBITO:
                return "Nota de débito electrónica";
            case BOLETA_EXENTA:
                return "Boleta exenta electrónica";
            default:
                return "Documento " + tipo;
        }
    }

    // -------------------------------------------------------------- RUT y DN

    /**
     * Saca el RUT de un texto libre (típicamente el DN del certificado).
     * Acepta {@code 12.345.678-9}, {@code 12345678-9} y {@code CL-12345678-9}.
     */
    private static String rutDe(String texto) {
        if (texto == null || texto.trim().isEmpty()) {
            return "";
        }
        Matcher m = Pattern.compile("(\\d{1,3}(?:\\.\\d{3})+|\\d{1,8})\\s*-\\s*([0-9kK])")
                .matcher(texto);
        while (m.find()) {
            String cuerpo = m.group(1).replace(".", "");
            if (cuerpo.length() >= 7 && cuerpo.length() <= 8) {
                return cuerpo + "-" + m.group(2).toUpperCase(Locale.ROOT);
            }
        }
        return "";
    }

    /**
     * Normaliza un RUT a {@code 12345678-9}. Si no se reconoce, devuelve vacío:
     * es preferible que el llamador muestre "falta el RUT" a emitir con basura.
     *
     * <p>Sin guion sólo se acepta un RUT de 9 caracteres (8 dígitos + DV), que
     * es el único caso inequívoco; con menos no se puede saber dónde termina el
     * cuerpo, y adivinar produciría un RUT distinto al del contribuyente.
     */
    private static String rutLimpio(String valor) {
        if (valor == null) {
            return "";
        }
        String s = valor.trim().toUpperCase(Locale.ROOT)
                .replace(".", "").replace(" ", "").replace("\t", "");
        if (s.isEmpty()) {
            return "";
        }
        if (s.startsWith("CL-")) {
            s = s.substring(3);
        }

        Matcher m = Pattern.compile("^(\\d{1,8})-([0-9K])$").matcher(s);
        if (m.matches()) {
            return m.group(1) + "-" + m.group(2);
        }
        m = Pattern.compile("^(\\d{8})([0-9K])$").matcher(s);
        if (m.matches()) {
            return m.group(1) + "-" + m.group(2);
        }

        // Texto alrededor ("RUT: 76123456-7"): se busca el tramo con guion.
        m = Pattern.compile("(\\d{1,8})-([0-9K])").matcher(s);
        if (m.find()) {
            return m.group(1) + "-" + m.group(2);
        }
        return "";
    }

    private static boolean rutValido(String rut) {
        return rut != null && rut.matches("\\d{1,8}-[0-9K]");
    }

    /**
     * Lee un atributo de un DN X.500 ({@code CN=..., SERIALNUMBER=...}).
     * Se parsea a mano porque Android no trae {@code javax.naming.ldap.LdapName}
     * y el DN puede venir con comas escapadas dentro del valor.
     */
    private static String atributo(String dn, String buscado) {
        if (dn == null || dn.isEmpty() || buscado == null) {
            return "";
        }
        StringBuilder parte = new StringBuilder();
        boolean comillas = false;
        int n = dn.length();
        for (int i = 0; i <= n; i++) {
            char ch = i < n ? dn.charAt(i) : ',';
            if (ch == '\\' && i + 1 < n) {
                parte.append(ch).append(dn.charAt(i + 1));
                i++;
                continue;
            }
            if (ch == '"') {
                comillas = !comillas;
            }
            if ((ch == ',' || ch == ';') && !comillas) {
                String trozo = parte.toString().trim();
                int igual = trozo.indexOf('=');
                if (igual > 0 && trozo.substring(0, igual).trim().equalsIgnoreCase(buscado)) {
                    return limpiarValor(trozo.substring(igual + 1));
                }
                parte.setLength(0);
            } else {
                parte.append(ch);
            }
        }
        return "";
    }

    private static String limpiarValor(String v) {
        String s = v == null ? "" : v.trim();
        if (s.length() >= 2 && s.charAt(0) == '"' && s.charAt(s.length() - 1) == '"') {
            s = s.substring(1, s.length() - 1);
        }
        return s.replace("\\,", ",").replace("\\;", ";")
                .replace("\\\"", "\"").replace("\\\\", "\\").trim();
    }

    // --------------------------------------------------------------- JSON

    /**
     * Primer valor de texto no vacío entre varias claves aceptadas. Devuelve
     * cadena vacía si no hay ninguno, para que el llamador decida qué exigir.
     */
    private static String campo(JSONObject o, String... claves) {
        if (o == null || claves == null) {
            return "";
        }
        for (int i = 0; i < claves.length; i++) {
            String k = claves[i];
            if (k == null) {
                continue;
            }
            Object v = o.opt(k);
            if (v == null || v == JSONObject.NULL) {
                continue;
            }
            String s = String.valueOf(v).trim();
            if (!s.isEmpty()) {
                return s;
            }
        }
        return "";
    }

    private static JSONObject objeto(JSONObject o, String... claves) {
        if (o != null && claves != null) {
            for (int i = 0; i < claves.length; i++) {
                JSONObject x = o.optJSONObject(claves[i]);
                if (x != null) {
                    return x;
                }
            }
        }
        return new JSONObject();
    }

    /**
     * Busca un arreglo en varias claves y acepta que venga serializado como
     * texto: la interfaz a veces manda el JSON "aplanado" en una cadena.
     */
    private static JSONArray arreglo(JSONObject o, String... claves) {
        if (o == null || claves == null) {
            return null;
        }
        for (int i = 0; i < claves.length; i++) {
            Object v = o.opt(claves[i]);
            if (v instanceof JSONArray) {
                return (JSONArray) v;
            }
            if (v instanceof String) {
                String s = ((String) v).trim();
                if (s.startsWith("[")) {
                    try {
                        return new JSONArray(s);
                    } catch (Throwable ignorado) {
                        // Texto que parece arreglo pero no lo es: se ignora.
                    }
                }
            }
        }
        return null;
    }

    private static double numero(JSONObject o, String clave, double porDefecto) {
        if (o == null || clave == null) {
            return porDefecto;
        }
        Object v = o.opt(clave);
        if (v == null || v == JSONObject.NULL) {
            return porDefecto;
        }
        if (v instanceof Number) {
            return ((Number) v).doubleValue();
        }
        try {
            return Double.parseDouble(String.valueOf(v).trim().replace(",", "."));
        } catch (Throwable t) {
            return porDefecto;
        }
    }

    /** Lee los ítems aceptando nombres en español, en inglés y las claves del XML. */
    private static void leerItems(JSONObject datos, List<String> nombres,
                                  List<Double> cantidades, List<Double> precios) {
        JSONArray items = arreglo(datos, "items", "detalle");
        if (items == null) {
            return;
        }
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            String nombre;
            double cantidad = 1;
            double precio = 0;
            if (it == null) {
                nombre = items.optString(i, "").trim();
                if (nombre.isEmpty()) {
                    continue;
                }
            } else {
                nombre = campo(it, "nombre", "nmbItem", "NmbItem", "descripcion");
                if (nombre.isEmpty()) {
                    nombre = "Item " + (i + 1);
                }
                cantidad = numero(it, "cantidad", numero(it, "qty", 1));
                precio = numero(it, "precio", numero(it, "prc", numero(it, "PrcItem", 0)));
            }
            if (cantidad <= 0) {
                cantidad = 1;
            }
            if (precio < 0) {
                precio = 0;
            }
            nombres.add(nombre);
            cantidades.add(Double.valueOf(cantidad));
            precios.add(Double.valueOf(precio));
        }
    }

    private static int entero(String texto, int porDefecto) {
        if (texto == null) {
            return porDefecto;
        }
        try {
            return Integer.parseInt(texto.trim());
        } catch (Throwable t) {
            return porDefecto;
        }
    }

    // -------------------------------------------------------------- base64/hash

    /**
     * Base64 estándar sin saltos de línea. Se implementa aquí para no depender
     * de {@code android.util.Base64} y poder probar la clase en una JVM normal.
     */
    private static String base64(byte[] datos) {
        if (datos == null || datos.length == 0) {
            return "";
        }
        StringBuilder sb = new StringBuilder(((datos.length + 2) / 3) * 4);
        int i = 0;
        while (i + 3 <= datos.length) {
            int n = ((datos[i] & 0xFF) << 16)
                    | ((datos[i + 1] & 0xFF) << 8)
                    | (datos[i + 2] & 0xFF);
            sb.append(B64[(n >>> 18) & 0x3F])
                    .append(B64[(n >>> 12) & 0x3F])
                    .append(B64[(n >>> 6) & 0x3F])
                    .append(B64[n & 0x3F]);
            i += 3;
        }
        int resto = datos.length - i;
        if (resto == 1) {
            int n = (datos[i] & 0xFF) << 16;
            sb.append(B64[(n >>> 18) & 0x3F])
                    .append(B64[(n >>> 12) & 0x3F])
                    .append("==");
        } else if (resto == 2) {
            int n = ((datos[i] & 0xFF) << 16) | ((datos[i + 1] & 0xFF) << 8);
            sb.append(B64[(n >>> 18) & 0x3F])
                    .append(B64[(n >>> 12) & 0x3F])
                    .append(B64[(n >>> 6) & 0x3F])
                    .append('=');
        }
        return sb.toString();
    }

    private static byte[] sha1(byte[] datos) throws Exception {
        return MessageDigest.getInstance("SHA-1").digest(datos);
    }

    // ------------------------------------------------------------------ errores

    private static String fallo(String motivo) {
        try {
            JSONObject r = new JSONObject();
            r.put("ok", false);
            r.put("error", motivo == null || motivo.trim().isEmpty()
                    ? "error desconocido" : motivo);
            return r.toString();
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"error desconocido\"}";
        }
    }

    private static String mensaje(Throwable t) {
        if (t == null) {
            return "error desconocido";
        }
        String m = t.getMessage();
        if (m == null || m.trim().isEmpty()) {
            m = t.getClass().getSimpleName();
        }
        return m;
    }

    /** Traduce los fallos típicos de PKCS12 a algo que se pueda mostrar. */
    private static String motivoCertificado(Throwable t) {
        String bruto = mensaje(t);
        String bajo = bruto.toLowerCase(Locale.ROOT);
        if (bajo.contains("password") || bajo.contains("mac")
                || bajo.contains("integrity") || bajo.contains("decrypt")) {
            return "no se pudo abrir el certificado: la clave no coincide "
                    + "o el archivo está dañado";
        }
        return bruto;
    }
}
