package com.threefat.vcts.ui.capture

import android.graphics.Bitmap
import android.graphics.Canvas as AndroidCanvas
import android.graphics.Color as AndroidColor
import android.graphics.Paint
import android.graphics.Path as AndroidPath
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.threefat.vcts.R
import java.io.FileOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignaturePadScreen(
    onCancel: () -> Unit,
    onSaved: () -> Unit,
    viewModel: SignaturePadViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    LaunchedEffect(state.savedFile) {
        if (state.savedFile != null) onSaved()
    }

    val strokes = remember { mutableListOf<List<Offset>>() }
    var currentStroke by remember { mutableStateOf<List<Offset>>(emptyList()) }
    var canvasSize by remember { mutableStateOf(IntSize.Zero) }
    var version by remember { mutableStateOf(0) }
    val density = LocalDensity.current

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.capture_signature_title)) },
                navigationIcon = {
                    IconButton(onClick = onCancel) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.common_back),
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Body(
            padding = padding,
            isEmpty = strokes.isEmpty() && currentStroke.isEmpty(),
            isSaving = state.isSaving,
            errorMessage = state.errorMessage,
            onClear = {
                strokes.clear()
                currentStroke = emptyList()
                version += 1
            },
            onSave = {
                scope.launch {
                    val bitmap = withContext(Dispatchers.Default) {
                        renderToBitmap(strokes, canvasSize)
                    }
                    val sink = viewModel.signatureFile()
                    val ok = withContext(Dispatchers.IO) {
                        FileOutputStream(sink).use { os ->
                            bitmap.compress(Bitmap.CompressFormat.PNG, 100, os)
                        }
                    }
                    if (ok) {
                        viewModel.persist(sink)
                    } else {
                        viewModel.failPersist(
                            context.getString(R.string.capture_signature_save_failed),
                        )
                    }
                }
            },
            content = {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.White, RoundedCornerShape(16.dp))
                        .pointerInput(Unit) {
                            detectTapGestures(
                                onTap = { offset ->
                                    strokes += listOf(listOf(offset, offset.copy(x = offset.x + 0.5f)))
                                    version += 1
                                },
                            )
                        }
                        .pointerInput(Unit) {
                            detectDragGestures(
                                onDragStart = { start -> currentStroke = listOf(start) },
                                onDragEnd = {
                                    if (currentStroke.size > 1) strokes += currentStroke
                                    currentStroke = emptyList()
                                    version += 1
                                },
                                onDrag = { change, _ ->
                                    currentStroke = currentStroke + change.position
                                    version += 1
                                },
                            )
                        },
                ) {
                    Canvas(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(8.dp),
                    ) {
                        canvasSize = IntSize(size.width.toInt(), size.height.toInt())
                        val composed = Path()
                        for (stroke in strokes) {
                            stroke.forEachIndexed { index, point ->
                                if (index == 0) composed.moveTo(point.x, point.y)
                                else composed.lineTo(point.x, point.y)
                            }
                        }
                        currentStroke.forEachIndexed { index, point ->
                            if (index == 0) composed.moveTo(point.x, point.y)
                            else composed.lineTo(point.x, point.y)
                        }
                        // Touch `version` so Compose sees the recomposition.
                        @Suppress("UNUSED_VARIABLE")
                        val tick = version
                        drawPath(
                            path = composed,
                            color = Color(0xFF0F172A),
                            style = Stroke(width = with(density) { 2.5.dp.toPx() }),
                        )
                    }

                    if (strokes.isEmpty() && currentStroke.isEmpty()) {
                        Text(
                            text = stringResource(R.string.capture_signature_hint),
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color.Gray,
                            modifier = Modifier
                                .padding(24.dp),
                        )
                    }
                }
            },
        )
    }
}

@Composable
private fun Body(
    padding: PaddingValues,
    isEmpty: Boolean,
    isSaving: Boolean,
    errorMessage: String?,
    onClear: () -> Unit,
    onSave: () -> Unit,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(padding)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(360.dp)
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(20.dp))
                .padding(8.dp),
        ) {
            content()
        }
        if (errorMessage != null) {
            Text(
                text = errorMessage,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(
                onClick = onClear,
                modifier = Modifier.weight(1f),
                enabled = !isEmpty && !isSaving,
            ) { Text(stringResource(R.string.capture_signature_clear)) }
            Button(
                onClick = onSave,
                modifier = Modifier.weight(1f),
                enabled = !isEmpty && !isSaving,
            ) { Text(stringResource(R.string.capture_signature_save)) }
        }
    }
}

private fun renderToBitmap(
    strokes: List<List<Offset>>,
    canvasSize: IntSize,
): Bitmap {
    val width = canvasSize.width.coerceAtLeast(1)
    val height = canvasSize.height.coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = AndroidCanvas(bitmap)
    canvas.drawColor(AndroidColor.WHITE)

    val paint = Paint().apply {
        color = AndroidColor.parseColor("#0F172A")
        strokeWidth = 6f
        style = Paint.Style.STROKE
        isAntiAlias = true
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    for (stroke in strokes) {
        val path = AndroidPath()
        stroke.forEachIndexed { index, p ->
            if (index == 0) path.moveTo(p.x, p.y) else path.lineTo(p.x, p.y)
        }
        canvas.drawPath(path, paint)
    }
    return bitmap
}
