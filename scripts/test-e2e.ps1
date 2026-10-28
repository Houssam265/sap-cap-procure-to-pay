# ==============================================================================
# Script de test E2E - Procure-to-Pay (Authentification, Rôles, Workflow & Validations)
# ==============================================================================

$base = "http://localhost:4004/odata/v4/procurement"

# Helper pour générer l'en-tête HTTP Basic Authentication
function Get-AuthHeader([string]$username, [string]$password) {
    $pair = "$username`:$password"
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($pair)
    $b64 = [Convert]::ToBase64String($bytes)
    return @{ "Authorization" = "Basic $b64" }
}

$authAlice = Get-AuthHeader "alice" "alice"   # Requester
$authBob   = Get-AuthHeader "bob"   "bob"     # Manager
$authCarol = Get-AuthHeader "carol" "carol"   # Warehouse
$authAdmin = Get-AuthHeader "admin" "admin"   # Admin
$authDave  = Get-AuthHeader "dave"  "dave"    # Second Requester

$global:passedTests  = 0
$global:failedTests  = 0
$global:ignoredTests = 0

# Helper pour ignorer un test dépendant
function Skip-HttpTest {
    param(
        [string]$TestId,
        [string]$Description,
        [string]$Reason
    )
    Write-Host "[$TestId] [IGNORE] $Description" -ForegroundColor DarkGray
    Write-Host "       -> Cause : $Reason" -ForegroundColor DarkGray
    $global:ignoredTests++
}

# Helper d'appel HTTP avec comparaison stricte du code d'état
function Invoke-HttpTest {
    param(
        [string]$TestId,
        [string]$Description,
        [string]$Method = "GET",
        [string]$Uri,
        [hashtable]$Headers = @{},
        $Body = $null,
        [int[]]$ExpectedStatus = @(200)
    )

    $params = @{
        Uri             = $Uri
        Method          = $Method
        Headers         = $Headers
        UseBasicParsing = $true
        TimeoutSec      = 15
    }

    if ($Body) {
        $params["ContentType"] = "application/json"
        if ($Body -is [string]) {
            $params["Body"] = $Body
        } else {
            $params["Body"] = ($Body | ConvertTo-Json -Depth 10)
        }
    }

    $actualStatus = 0
    $data = $null

    try {
        $resp = Invoke-WebRequest @params
        $actualStatus = [int]$resp.StatusCode
        if ($resp.Content) {
            $data = $resp.Content | ConvertFrom-Json -ErrorAction SilentlyContinue
        }
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) {
            $actualStatus = [int]$_.Exception.Response.StatusCode
        } else {
            Write-Host "[$TestId] [ECHEC] $Description" -ForegroundColor Red
            Write-Host "       -> Erreur de connexion au serveur ($($_.Message))" -ForegroundColor Red
            $global:failedTests++
            return @{ Success = $false; StatusCode = 0; Data = $null }
        }
    } catch {
        Write-Host "[$TestId] [ECHEC] $Description" -ForegroundColor Red
        Write-Host "       -> Erreur inattendue ($($_.Message))" -ForegroundColor Red
        $global:failedTests++
        return @{ Success = $false; StatusCode = 0; Data = $null }
    }

    $expectedStr = ($ExpectedStatus -join ' ou ')
    $isMatch = $ExpectedStatus -contains $actualStatus

    if ($isMatch) {
        Write-Host "[$TestId] [REUSSI] $Description | Code recu: $actualStatus (Attendu: $expectedStr)" -ForegroundColor Green
        $global:passedTests++
    } else {
        Write-Host "[$TestId] [ECHEC]  $Description | Code recu: $actualStatus (Attendu: $expectedStr)" -ForegroundColor Red
        $global:failedTests++
    }

    return @{
        Success    = $isMatch
        StatusCode = $actualStatus
        Data       = $data
    }
}

Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host ">>> SUITE DE TESTS PROCURE-TO-PAY : AUTHENTIFICATION, WORKFLOW & VALIDATIONS <<<" -ForegroundColor Cyan
Write-Host "==============================================================================" -ForegroundColor Cyan

# ==============================================================================
# SECTION 1 : AUTHENTIFICATION ET RESTRICTIONS DE ROLES (ETAPE 3)
# ==============================================================================
Write-Host "`n--- SECTION 1 : AUTHENTIFICATION & ROLES ---" -ForegroundColor Yellow

# 1.1 Requete sans identifiants
Invoke-HttpTest -TestId "1.1" -Description "Requete anonyme sans credentials" `
    -Method "GET" -Uri "$base/Products" -ExpectedStatus @(401) | Out-Null

# 1.2 Requete avec mot de passe incorrect
$badAuth = Get-AuthHeader "alice" "wrongpassword"
Invoke-HttpTest -TestId "1.2" -Description "Requete avec mot de passe errone" `
    -Method "GET" -Uri "$base/Products" -Headers $badAuth -ExpectedStatus @(401) | Out-Null

# 1.3 Requester tente de lire les commandes d'achat
Invoke-HttpTest -TestId "1.3" -Description "Requester tente d'acceder aux commandes (/PurchaseOrders)" `
    -Method "GET" -Uri "$base/PurchaseOrders" -Headers $authAlice -ExpectedStatus @(403) | Out-Null

# 1.4 Requester tente de creer directement un produit
$newProdBody = @{
    code        = "NEW-PROD"
    name        = "Nouveau Produit"
    price       = 100
    currency    = "MAD"
    supplier_ID = "11111111-1111-1111-1111-111111111111"
}
Invoke-HttpTest -TestId "1.4" -Description "Requester tente de creer un produit (reserve a Admin)" `
    -Method "POST" -Uri "$base/Products" -Headers $authAlice -Body $newProdBody -ExpectedStatus @(403) | Out-Null

# 1.5 Admin cree un produit avec succes
$adminProd = Invoke-HttpTest -TestId "1.5" -Description "Admin cree un produit dans le catalogue" `
    -Method "POST" -Uri "$base/Products" -Headers $authAdmin -Body $newProdBody -ExpectedStatus @(201)

# Nettoyage du produit cree par Admin
if ($adminProd.Data -and $adminProd.Data.ID) {
    Invoke-HttpTest -TestId "1.5b" -Description "Admin supprime le produit de test non utilise" `
        -Method "DELETE" -Uri "$base/Products(ID=$($adminProd.Data.ID))" -Headers $authAdmin -ExpectedStatus @(204) | Out-Null
}

# ==============================================================================
# SECTION 2 : WORKFLOW COMPLET DU CYCLE PROCURE-TO-PAY (NON-REGRESSION)
# ==============================================================================
Write-Host "`n--- SECTION 2 : CYCLE METIER COMPLET AVEC ROLES DEDIES ---" -ForegroundColor Yellow

$prCreated       = $false
$prSubmitted     = $false
$prApproved      = $false
$ordersCreated   = $false
$movementsLogged = $false
$prId            = $null
$targetPoId      = $null

# 2.1 Alice consulte le catalogue produits
Invoke-HttpTest -TestId "2.1" -Description "Alice (Requester) consulte la liste des produits" `
    -Method "GET" -Uri "$base/Products" -Headers $authAlice -ExpectedStatus @(200) | Out-Null

# 2.2 Alice cree une demande d'achat
$prPayload = @{
    description = "Demande d'achat materiel informatique et fournitures"
    items = @(
        @{ product_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; quantity = 5 }, # Fournisseur 1 (Laptop)
        @{ product_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc"; quantity = 10 } # Fournisseur 2 (Papier)
    )
}
$prStep = Invoke-HttpTest -TestId "2.2" -Description "Alice cree une demande d'achat avec 2 articles" `
    -Method "POST" -Uri "$base/PurchaseRequests" -Headers $authAlice -Body $prPayload -ExpectedStatus @(201)

if ($prStep.Success -and $prStep.Data -and $prStep.Data.ID) {
    $prCreated = $true
    $prId = $prStep.Data.ID
}

# 2.3 Dave (autre Requester) tente de lire la demande d'Alice
if ($prCreated) {
    Invoke-HttpTest -TestId "2.3" -Description "Dave (autre Requester) tente de lire la demande d'Alice" `
        -Method "GET" -Uri "$base/PurchaseRequests(ID=$prId)" -Headers $authDave -ExpectedStatus @(403, 404) | Out-Null
} else {
    Skip-HttpTest -TestId "2.3" -Description "Dave tente de lire la demande d'Alice" -Reason "Demande non creee au test 2.2"
}

# 2.4 Alice tente d'approuver sa propre demande (interdit)
if ($prCreated) {
    Invoke-HttpTest -TestId "2.4" -Description "Alice tente d'approuver sa propre demande (reserve a Manager)" `
        -Method "POST" -Uri "$base/PurchaseRequests(ID=$prId)/approve" -Headers $authAlice -Body "{}" -ExpectedStatus @(403) | Out-Null
} else {
    Skip-HttpTest -TestId "2.4" -Description "Alice tente d'approuver sa demande" -Reason "Demande non creee au test 2.2"
}

# 2.5 Alice soumet sa demande d'achat
if ($prCreated) {
    $subStep = Invoke-HttpTest -TestId "2.5" -Description "Alice soumet sa demande d'achat (DRAFT -> SUBMITTED)" `
        -Method "POST" -Uri "$base/PurchaseRequests(ID=$prId)/submit" -Headers $authAlice -Body "{}" -ExpectedStatus @(200)
    if ($subStep.Success) { $prSubmitted = $true }
} else {
    Skip-HttpTest -TestId "2.5" -Description "Alice soumet sa demande" -Reason "Demande non creee au test 2.2"
}

# 2.6 Bob (Manager) consulte la demande d'achat soumise par Alice
if ($prSubmitted) {
    Invoke-HttpTest -TestId "2.6" -Description "Bob (Manager) consulte la demande soumise" `
        -Method "GET" -Uri "$base/PurchaseRequests(ID=$prId)" -Headers $authBob -ExpectedStatus @(200) | Out-Null
} else {
    Skip-HttpTest -TestId "2.6" -Description "Bob consulte la demande soumise" -Reason "Demande non soumise au test 2.5"
}

# 2.7 Bob approuve la demande d'achat
if ($prSubmitted) {
    $appStep = Invoke-HttpTest -TestId "2.7" -Description "Bob approuve la demande d'achat (SUBMITTED -> APPROVED)" `
        -Method "POST" -Uri "$base/PurchaseRequests(ID=$prId)/approve" -Headers $authBob -Body "{}" -ExpectedStatus @(200)
    if ($appStep.Success) { $prApproved = $true }
} else {
    Skip-HttpTest -TestId "2.7" -Description "Bob approuve la demande" -Reason "Demande non soumise au test 2.5"
}

# 2.8 Bob genere les commandes d'achat
if ($prApproved) {
    $poStep = Invoke-HttpTest -TestId "2.8" -Description "Bob genere les commandes d'achat (1 par fournisseur distinct)" `
        -Method "POST" -Uri "$base/PurchaseRequests(ID=$prId)/createPurchaseOrder" -Headers $authBob -Body "{}" -ExpectedStatus @(200)
    
    if ($poStep.Success -and $poStep.Data -and $poStep.Data.value -and $poStep.Data.value.Count -gt 0) {
        $ordersCreated = $true
        $targetPoId = $poStep.Data.value[0].ID
    }
} else {
    Skip-HttpTest -TestId "2.8" -Description "Bob genere les commandes" -Reason "Demande non approuvee au test 2.7"
}

# 2.9 Bob tente de receptionner la commande (interdit)
if ($ordersCreated) {
    Invoke-HttpTest -TestId "2.9" -Description "Bob (Manager) tente de receptionner (reserve a Warehouse)" `
        -Method "POST" -Uri "$base/PurchaseOrders(ID=$targetPoId)/receive" -Headers $authBob -Body "{}" -ExpectedStatus @(403) | Out-Null
} else {
    Skip-HttpTest -TestId "2.9" -Description "Bob tente de receptionner" -Reason "Aucune commande creee au test 2.8"
}

# 2.10 Carol (Warehouse) consulte la commande
if ($ordersCreated) {
    Invoke-HttpTest -TestId "2.10" -Description "Carol (Warehouse) consulte la commande d'achat" `
        -Method "GET" -Uri "$base/PurchaseOrders(ID=$targetPoId)" -Headers $authCarol -ExpectedStatus @(200) | Out-Null
} else {
    Skip-HttpTest -TestId "2.10" -Description "Carol consulte la commande" -Reason "Aucune commande creee au test 2.8"
}

# 2.11 Carol effectue une reception partielle
if ($ordersCreated) {
    $partBody = @{
        items = @( @{ product = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; quantity = 2 } )
    }
    Invoke-HttpTest -TestId "2.11" -Description "Carol enregistre une reception partielle (2/5 articles)" `
        -Method "POST" -Uri "$base/PurchaseOrders(ID=$targetPoId)/receive" -Headers $authCarol -Body $partBody -ExpectedStatus @(200) | Out-Null
} else {
    Skip-HttpTest -TestId "2.11" -Description "Carol enregistre une reception partielle" -Reason "Aucune commande creee au test 2.8"
}

# 2.12 Carol receptionne le solde restant
if ($ordersCreated) {
    $recStep = Invoke-HttpTest -TestId "2.12" -Description "Carol receptionne le restant du (solde automatique)" `
        -Method "POST" -Uri "$base/PurchaseOrders(ID=$targetPoId)/receive" -Headers $authCarol -Body "{}" -ExpectedStatus @(200)
    if ($recStep.Success) { $movementsLogged = $true }
} else {
    Skip-HttpTest -TestId "2.12" -Description "Carol receptionne le restant du" -Reason "Aucune commande creee au test 2.8"
}

# 2.13 Carol consulte l'historique des mouvements de stock
if ($ordersCreated) {
    Invoke-HttpTest -TestId "2.13" -Description "Carol consulte les mouvements de stock historiques" `
        -Method "GET" -Uri "$base/StockMovements" -Headers $authCarol -ExpectedStatus @(200) | Out-Null
} else {
    Skip-HttpTest -TestId "2.13" -Description "Carol consulte les mouvements de stock" -Reason "Aucune commande creee au test 2.8"
}


# ==============================================================================
# SECTION 3 : REGLES METIER ET CAS D'ERREURS (ETAPE 2)
# ==============================================================================
Write-Host "`n--- SECTION 3 : REGLES METIER & VALIDATIONS ---" -ForegroundColor Yellow

# 3.1 Format email invalide sur fournisseur
$badSupplier = @{ name = "Fournisseur Invalide"; email = "email-sans-arobase" }
Invoke-HttpTest -TestId "3.1" -Description "Format email invalide rejete (@assert.format)" `
    -Method "POST" -Uri "$base/Suppliers" -Headers $authAdmin -Body $badSupplier -ExpectedStatus @(400) | Out-Null

# 3.2 Quantite negative sur article
$badPrBody = @{
    description = "Demande invalide"
    items = @( @{ product_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; quantity = -5 } )
}
Invoke-HttpTest -TestId "3.2" -Description "Quantite negative sur article rejetee (@assert.range)" `
    -Method "POST" -Uri "$base/PurchaseRequests" -Headers $authAlice -Body $badPrBody -ExpectedStatus @(400) | Out-Null

# 3.3 Modification d'une demande approuvee (interdite - 409)
if ($prApproved) {
    $patchBody = @{ description = "Tentative de modification illicite" }
    Invoke-HttpTest -TestId "3.3" -Description "Modification d'une demande APPROVED rejetee (409)" `
        -Method "PATCH" -Uri "$base/PurchaseRequests(ID=$prId)" -Headers $authAlice -Body $patchBody -ExpectedStatus @(409) | Out-Null
} else {
    Skip-HttpTest -TestId "3.3" -Description "Modification demande APPROVED" -Reason "Aucune demande en statut APPROVED disponible"
}

# 3.4 Suppression d'une demande approuvee (interdite - 409)
if ($prApproved) {
    Invoke-HttpTest -TestId "3.4" -Description "Suppression d'une demande APPROVED rejetee (409)" `
        -Method "DELETE" -Uri "$base/PurchaseRequests(ID=$prId)" -Headers $authAlice -ExpectedStatus @(409) | Out-Null
} else {
    Skip-HttpTest -TestId "3.4" -Description "Suppression demande APPROVED" -Reason "Aucune demande en statut APPROVED disponible"
}

# 3.5 Suppression d'un produit lie a des mouvements (interdite - 409)
if ($movementsLogged) {
    Invoke-HttpTest -TestId "3.5" -Description "Suppression produit avec historique de stock rejetee (409)" `
        -Method "DELETE" -Uri "$base/Products(ID=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa)" -Headers $authAdmin -ExpectedStatus @(409) | Out-Null
} else {
    Skip-HttpTest -TestId "3.5" -Description "Suppression produit avec historique" -Reason "Aucun mouvement de stock enregistre prealablement"
}

# 3.6 Creation directe d'une commande d'achat (interdite @readonly - 405)
$directPo = @{ number = "PO-HACK"; supplier_ID = "11111111-1111-1111-1111-111111111111"; totalAmount = 500 }
Invoke-HttpTest -TestId "3.6" -Description "Creation directe de commande rejetee (405 @readonly)" `
    -Method "POST" -Uri "$base/PurchaseOrders" -Headers $authCarol -Body $directPo -ExpectedStatus @(405) | Out-Null


# ==============================================================================
# BILAN DES TESTS
# ==============================================================================
$totalExecuted = $global:passedTests + $global:failedTests
Write-Host "`n==============================================================================" -ForegroundColor Cyan
Write-Host "BILAN DES TESTS : $global:passedTests REUSSIS / $totalExecuted EXECUTES ($global:ignoredTests IGNORES)" -ForegroundColor $(if ($global:failedTests -eq 0 -and $totalExecuted -gt 0) { "Green" } else { "Red" })
Write-Host "==============================================================================" -ForegroundColor Cyan

if ($global:failedTests -gt 0 -or $totalExecuted -eq 0) {
    exit 1
} else {
    exit 0
}
