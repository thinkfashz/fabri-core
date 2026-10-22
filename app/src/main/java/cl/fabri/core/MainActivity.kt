package cl.fabri.core

import android.app.Application
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

class FabriApp : Application() {
    lateinit var db: DbHelper
        private set
    lateinit var themes: ThemeStore
        private set
    override fun onCreate() {
        super.onCreate()
        db = DbHelper(this)
        themes = ThemeStore(this)
    }
}

/* ─────────── Rutas: las 17 pantallas del contrato ─────────── */
enum class Route(val path: String, val title: String, val icon: ImageVector) {
    HOME("/home", "Panel", Icons.Filled.Dashboard),
    CHAT("/chat", "Chat IA", Icons.Filled.Chat),
    TERMINAL("/terminal", "Terminal", Icons.Filled.Terminal),
    INSTALLER("/installer", "Instalador", Icons.Filled.Download),
    PROJECTS("/projects", "Proyectos", Icons.Filled.Folder),
    DATABASE("/database", "Base de datos", Icons.Filled.Storage),
    MEMORY("/memory", "Memoria RAG", Icons.Filled.Psychology),
    DOCUMENTS("/documents", "Documentos", Icons.Filled.Description),
    INVOICES("/invoices", "Facturas", Icons.Filled.Receipt),
    ANALYTICS("/analytics", "Análisis", Icons.Filled.Insights),
    SYSTEM("/system", "Sistema", Icons.Filled.Memory),
    CATALOG_PRODUCTS("/catalog/products", "Catálogo de productos", Icons.Filled.Inventory2),
    CATALOG_DOCUMENTS("/catalog/documents", "Catálogo de documentos", Icons.Filled.LibraryBooks),
    BRAND("/settings/brand-invoice", "Marca", Icons.Filled.Brush),
    EXPORTS("/exports", "Exportación", Icons.Filled.IosShare),
    LIVE("/workflow/live", "Flujos en vivo", Icons.Filled.Hub),
    SETTINGS("/settings", "Ajustes", Icons.Filled.Settings)
}

private val PRIMARY = listOf(Route.HOME, Route.CHAT, Route.LIVE, Route.EXPORTS, Route.SETTINGS)

@OptIn(ExperimentalMaterial3Api::class)
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as FabriApp
        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    primary = Color(app.themes.theme.accent),
                    onPrimary = Color(0xFF050505),
                    background = Color(0xFF050505),
                    surface = Color(0xFF101010),
                    surfaceVariant = Color(0xFF171717),
                    onBackground = Color(0xFFF5F5F5),
                    onSurface = Color(0xFFF5F5F5),
                    outline = Color(0xFF282828)
                )
            ) {
                FabShell(app)
            }
        }
    }
}

@Composable
fun FabShell(app: FabriApp) {
    var route by rememberSaveable { mutableStateOf(Route.HOME) }
    val accent = Color(app.themes.theme.accent)
    BackHandler(enabled = route != Route.HOME) { route = Route.HOME }

    Scaffold(
        containerColor = Color(0xFF050505),
        topBar = {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF101010))
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier
                        .size(26.dp)
                        .background(accent, RoundedCornerShape(7.dp))
                )
                Spacer(Modifier.width(10.dp))
                Text("FABRI-CORE", fontWeight = FontWeight.Black, fontSize = 17.sp, letterSpacing = 1.sp)
                Spacer(Modifier.weight(1f))
                Text(route.path, color = Color(0xFF858585), fontSize = 11.sp)
            }
        },
        bottomBar = {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF101010))
                    .padding(vertical = 6.dp),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                PRIMARY.forEach { r ->
                    Column(
                        Modifier
                            .clickable { route = r }
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            r.icon,
                            contentDescription = r.title,
                            tint = if (route == r) accent else Color(0xFF858585),
                            modifier = Modifier.size(20.dp)
                        )
                        Text(
                            r.title,
                            fontSize = 9.sp,
                            color = if (route == r) accent else Color(0xFF858585)
                        )
                    }
                }
            }
        }
    ) { pad ->
        Box(Modifier.padding(pad)) {
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp)
            ) {
                when (route) {
                    Route.HOME -> PanelScreen(app)
                    Route.CHAT -> ChatScreen(app)
                    Route.TERMINAL -> TerminalScreen(app)
                    Route.INSTALLER -> InstallerScreen(app)
                    Route.PROJECTS -> ProjectsScreen(app)
                    Route.DATABASE -> DatabaseScreen(app)
                    Route.MEMORY -> MemoryScreen(app)
                    Route.DOCUMENTS -> DocumentsScreen(app)
                    Route.INVOICES -> InvoicesScreen(app)
                    Route.ANALYTICS -> AnalyticsScreen(app)
                    Route.SYSTEM -> SystemScreen(app)
                    Route.CATALOG_PRODUCTS -> CatalogProductsScreen(app)
                    Route.CATALOG_DOCUMENTS -> CatalogDocumentsScreen(app)
                    Route.BRAND -> BrandScreen(app)
                    Route.EXPORTS -> ExportsScreen(app)
                    Route.LIVE -> LiveScreen(app)
                    Route.SETTINGS -> SettingsScreen(app, route) { route = it }
                }
            }
        }
    }
}

/* ─────────── Componentes de apoyo ─────────── */

@Composable
fun Section(title: String, accent: Color) {
    Spacer(Modifier.height(18.dp))
    Text(
        title.uppercase(),
        color = accent,
        fontSize = 11.sp,
        letterSpacing = 2.sp,
        fontWeight = FontWeight.Bold
    )
    Spacer(Modifier.height(8.dp))
}

@Composable
fun Card(title: String?, value: String, detail: String = "", accent: Color = Color(0xFFC8FF00)) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFF171717)),
        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF282828)),
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp)
    ) {
        Column(Modifier.padding(14.dp)) {
            if (title != null) {
                Text(title, color = Color(0xFF858585), fontSize = 11.sp, letterSpacing = 1.sp)
                Spacer(Modifier.height(4.dp))
            }
            Text(value, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            if (detail.isNotBlank()) {
                Spacer(Modifier.height(3.dp))
                Text(detail, color = Color(0xFF858585), fontSize = 12.sp)
            }
        }
    }
}

@Composable
fun StatusRow(label: String, value: String, ok: Boolean, accent: Color) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .size(8.dp)
                .background(if (ok) accent else Color(0xFFFF6B6B), RoundedCornerShape(4.dp))
        )
        Spacer(Modifier.width(10.dp))
        Text(label, color = Color(0xFF858585), fontSize = 13.sp, modifier = Modifier.width(130.dp))
        Text(value, fontSize = 13.sp, color = Color(0xFFF5F5F5))
    }
}

@Composable
fun ScreenTitle(t: String, sub: String = "") {
    Text(t, fontSize = 22.sp, fontWeight = FontWeight.Black)
    if (sub.isNotBlank()) {
        Spacer(Modifier.height(4.dp))
        Text(sub, color = Color(0xFF858585), fontSize = 13.sp)
    }
}
