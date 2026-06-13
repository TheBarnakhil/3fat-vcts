package com.threefat.vcts.ui.collection

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.threefat.vcts.R
import com.threefat.vcts.data.repository.IntegrationMode
import com.threefat.vcts.domain.model.PaymentMode
import com.threefat.vcts.ui.cms.JsonSchemaForm
import com.threefat.vcts.ui.theme.MonoFamily
import androidx.compose.foundation.text.KeyboardOptions

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollectionFormScreen(
    onBack: () -> Unit,
    onSubmitted: (collectionId: String, replayed: Boolean) -> Unit,
    onOpenWebView: (url: String) -> Unit,
    viewModel: CollectionFormViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val context = LocalContext.current

    LaunchedEffect(Unit) {
        viewModel.events.collect { event ->
            when (event) {
                is CollectionFormEvent.NavigateToReceipt ->
                    onSubmitted(event.collectionId, event.replayed)
                is CollectionFormEvent.NavigateToWebView ->
                    onOpenWebView(event.url)
            }
        }
    }

    LaunchedEffect(state.cmsFieldError) {
        val missing = state.cmsFieldError ?: return@LaunchedEffect
        snackbar.showSnackbar(
            message = context.getString(R.string.collection_cms_field_required, missing),
        )
    }

    LaunchedEffect(state.submissionError) {
        val err = state.submissionError ?: return@LaunchedEffect
        snackbar.showSnackbar(message = err.toUserMessage(context))
        viewModel.onErrorDismissed()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.collection_form_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
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
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Body(padding = padding, state = state, viewModel = viewModel)
        if (state.showConfirm) {
            ConfirmDialog(
                state = state,
                onDismiss = viewModel::onConfirmCancel,
                onConfirm = viewModel::onConfirmSubmit,
            )
        }
    }
}

@Composable
private fun Body(
    padding: PaddingValues,
    state: CollectionFormUiState,
    viewModel: CollectionFormViewModel,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(padding)
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        state.customer?.let { c ->
            Text(
                text = c.name,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Medium,
            )
            c.code?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.labelSmall,
                    fontFamily = MonoFamily,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        OutlinedTextField(
            value = state.amountText,
            onValueChange = viewModel::onAmountChange,
            label = { Text(stringResource(R.string.collection_amount)) },
            placeholder = { Text("0.00") },
            singleLine = true,
            isError = state.fieldError == CollectionFieldError.AmountInvalid,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth(),
        )

        Text(
            text = stringResource(R.string.collection_payment_mode),
            style = MaterialTheme.typography.labelLarge,
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            PaymentMode.entries.forEach { mode ->
                FilterChip(
                    selected = state.paymentMode == mode,
                    onClick = { viewModel.onPaymentModeChange(mode) },
                    label = { Text(mode.display) },
                )
            }
        }

        if (PaymentMode.requiresReference(state.paymentMode)) {
            OutlinedTextField(
                value = state.refNo.orEmpty(),
                onValueChange = viewModel::onRefNoChange,
                label = { Text(stringResource(R.string.collection_ref_no)) },
                singleLine = true,
                isError = state.fieldError == CollectionFieldError.RefRequired,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        if (state.paymentMode == PaymentMode.Cheque) {
            OutlinedTextField(
                value = state.chequeDate.orEmpty(),
                onValueChange = viewModel::onChequeDateChange,
                label = { Text(stringResource(R.string.collection_cheque_date)) },
                placeholder = { Text("YYYY-MM-DD") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        OutlinedTextField(
            value = state.remarks.orEmpty(),
            onValueChange = viewModel::onRemarksChange,
            label = { Text(stringResource(R.string.collection_remarks)) },
            modifier = Modifier
                .fillMaxWidth()
                .height(96.dp),
        )

        if (state.integrationMode == IntegrationMode.Offline && state.cmsFields.isNotEmpty()) {
            HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
            JsonSchemaForm(
                fields = state.cmsFields,
                values = state.cmsValues,
                onValueChange = viewModel::onCmsFieldChange,
                errorFieldTitle = state.cmsFieldError,
            )
        }

        if (state.integrationMode == IntegrationMode.WebView && !state.webviewUrl.isNullOrBlank()) {
            HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
            OutlinedButton(
                onClick = viewModel::onOpenWebViewClick,
                enabled = !state.isSubmitting,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.cms_webview_open))
            }
        }

        Button(
            onClick = viewModel::onReviewClick,
            enabled = !state.isSubmitting && state.customer != null,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            shape = MaterialTheme.shapes.medium,
        ) {
            if (state.isSubmitting) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.height(18.dp),
                            strokeWidth = 2.dp,
                        )
                        Text(stringResource(R.string.collection_submitting))
                    }
                }
            } else {
                Text(stringResource(R.string.collection_review))
            }
        }
    }
}

@Composable
private fun ConfirmDialog(
    state: CollectionFormUiState,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    val customer = state.customer ?: return
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.collection_review_dialog_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(text = customer.name, style = MaterialTheme.typography.titleMedium)
                Text(
                    text = stringResource(
                        R.string.collection_review_dialog_amount,
                        state.amountText.ifBlank { "0" },
                    ),
                    fontFamily = MonoFamily,
                )
                Text(
                    text = stringResource(
                        R.string.collection_review_dialog_mode,
                        state.paymentMode.display,
                    ),
                )
                if (PaymentMode.requiresReference(state.paymentMode) && !state.refNo.isNullOrBlank()) {
                    Text("Ref: ${state.refNo}", fontFamily = MonoFamily)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(stringResource(R.string.collection_review_dialog_confirm))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.collection_review_dialog_cancel))
            }
        },
    )
}

private fun CollectionSubmitError.toUserMessage(context: Context): String = when (this) {
    is CollectionSubmitError.OutsideFence -> context.getString(
        R.string.collection_error_geofence,
        distanceM,
        allowedM,
    )
    is CollectionSubmitError.GpsTooLow -> context.getString(
        R.string.collection_error_gps,
        accuracyM,
        allowedM,
    )
    is CollectionSubmitError.RateLimited ->
        serverMessage ?: context.getString(R.string.collection_error_rate_limit)
    is CollectionSubmitError.Forbidden ->
        serverMessage ?: context.getString(R.string.collection_error_forbidden)
    is CollectionSubmitError.Validation ->
        serverMessage ?: context.getString(R.string.collection_error_validation)
    is CollectionSubmitError.Server ->
        serverMessage ?: context.getString(R.string.collection_error_server)
    is CollectionSubmitError.Offline ->
        context.getString(R.string.collection_error_offline)
    is CollectionSubmitError.LocationUnavailable ->
        context.getString(R.string.customer_locating)
}
