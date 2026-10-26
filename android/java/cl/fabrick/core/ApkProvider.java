package cl.fabrick.core;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.provider.OpenableColumns;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * FABRI-CORE · proveedor mínimo para entregar una APK verificada al instalador
 * del sistema.
 *
 * Android 7+ prohíbe `file://` en Intents. En vez de descargar AndroidX
 * (cientos de KB y una dependencia más), este ContentProvider expone un único
 * archivo fijo: filesDir/actualizaciones/update.apk. No acepta rutas de la URL
 * ni permite leer otros archivos.
 */
public final class ApkProvider extends ContentProvider {

    public static final String AUTHORITY = "cl.fabrick.core.apk";
    public static final String RUTA = "actualizaciones/update.apk";

    @Override
    public boolean onCreate() {
        return true;
    }

    private File archivo() {
        return new File(getContext().getFilesDir(), RUTA);
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = archivo();
        if (!f.isFile()) {
            throw new FileNotFoundException("no hay actualización verificada");
        }
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        File f = archivo();
        MatrixCursor cursor = new MatrixCursor(new String[]{
                OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE
        });
        if (f.isFile()) {
            cursor.addRow(new Object[]{"update.apk", f.length()});
        }
        return cursor;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
