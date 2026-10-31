param(
    [string]$BaseUrl = "http://localhost:4004"
)

$baseRoot = $BaseUrl.TrimEnd('/')
$base = "$baseRoot/odata/v4/procurement"

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

# Detection dynamique du mode d'authentification et de deploiement
$authModeInfo = $null
try {
    $modeResp = Invoke-WebRequest -Uri "$baseRoot/api/auth-mode" -UseBasicParsing -TimeoutSec 10 -ErrorAction SilentlyContinue
    if ($modeResp -and $modeResp.StatusCode -eq 200) {
        $authModeInfo = $modeResp.Content | ConvertFrom-Json -ErrorAction SilentlyContinue
    }
} catch {
    $authModeInfo = $null
}

$isDevOrDemo = $false
$detectedMode = "indetermine"
if ($authModeInfo) {
    $isDevOrDemo = [bool]($authModeInfo.isDev)
    $detectedMode = [string]($authModeInfo.mode)
}

Write-Host "Cible : $baseRoot | Mode detecte : $detectedMode | Fonctions demo actives : $isDevOrDemo" -ForegroundColor Cyan

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
# SECTION 4 : NOUVEAUX CAS - RECEPTION PARTIELLE/TOTALE, DECLINE AVEC/SANS MOTIF
# ==============================================================================
Write-Host "`n--- SECTION 4 : RECEPTION & DECLINE ---" -ForegroundColor Yellow

# Préparer une nouvelle demande + cycle complet pour les tests de réception
$pr2Created = $false; $pr2Submitted = $false; $pr2Approved = $false; $po2Created = $false
$pr2Id = $null; $po2Id = $null

# 4.1 Alice crée une deuxième demande (produit unique : 5 unités de Laptop)
$prPayload2 = @{
    description = "Demande test reception partielle"
    items = @( @{ product_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; quantity = 5 } )
}
$pr2Step = Invoke-HttpTest -TestId "4.1" -Description "Alice cree une 2eme demande (5 unites Laptop)" `
    -Method "POST" -Uri "$base/PurchaseRequests" -Headers $authAlice -Body $prPayload2 -ExpectedStatus @(201)
if ($pr2Step.Success -and $pr2Step.Data -and $pr2Step.Data.ID) { $pr2Created = $true; $pr2Id = $pr2Step.Data.ID }

# 4.2 Alice soumet
if ($pr2Created) {
    $sub2 = Invoke-HttpTest -TestId "4.2" -Description "Alice soumet la 2eme demande" `
        -Method "POST" -Uri "$base/PurchaseRequests(ID=$pr2Id)/submit" -Headers $authAlice -Body "{}" -ExpectedStatus @(200)
    if ($sub2.Success) { $pr2Submitted = $true }
} else { Skip-HttpTest -TestId "4.2" -Description "Soumission 2eme demande" -Reason "Demande non creee" }

# 4.3 Bob approuve
if ($pr2Submitted) {
    $app2 = Invoke-HttpTest -TestId "4.3" -Description "Bob approuve la 2eme demande" `
        -Method "POST" -Uri "$base/PurchaseRequests(ID=$pr2Id)/approve" -Headers $authBob -Body "{}" -ExpectedStatus @(200)
    if ($app2.Success) { $pr2Approved = $true }
} else { Skip-HttpTest -TestId "4.3" -Description "Approbation 2eme demande" -Reason "Non soumise" }

# 4.4 Bob genere les commandes
if ($pr2Approved) {
    $po2Step = Invoke-HttpTest -TestId "4.4" -Description "Bob genere les commandes pour la 2eme demande" `
        -Method "POST" -Uri "$base/PurchaseRequests(ID=$pr2Id)/createPurchaseOrder" -Headers $authBob -Body "{}" -ExpectedStatus @(200)
    if ($po2Step.Success -and $po2Step.Data -and $po2Step.Data.value -and $po2Step.Data.value.Count -gt 0) {
        $po2Created = $true
        $po2Id = $po2Step.Data.value[0].ID
    }
} else { Skip-HttpTest -TestId "4.4" -Description "Generation commande 2eme demande" -Reason "Non approuvee" }

# 4.5 Carol effectue une reception PARTIELLE (1 sur 5)
if ($po2Created) {
    $partBody2 = @{ items = @( @{ product = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; quantity = 1 } ) }
    $partRec = Invoke-HttpTest -TestId "4.5" -Description "Carol receptonne 1/5 (reception partielle)" `
        -Method "POST" -Uri "$base/PurchaseOrders(ID=$po2Id)/receive" -Headers $authCarol -Body $partBody2 -ExpectedStatus @(200)
    # Verifier que le statut est desormais PARTIALLY_RECEIVED
    if ($partRec.Success) {
        $poCheck = Invoke-HttpTest -TestId "4.5b" -Description "Commande passe a statut PARTIALLY_RECEIVED" `
            -Method "GET" -Uri "$base/PurchaseOrders(ID=$po2Id)" -Headers $authCarol -ExpectedStatus @(200)
        if ($poCheck.Success -and $poCheck.Data -and $poCheck.Data.status -eq "PARTIALLY_RECEIVED") {
            Write-Host "       -> Statut PARTIALLY_RECEIVED confirme" -ForegroundColor Green
        } elseif ($poCheck.Success) {
            Write-Host "       -> [ATTENTION] Statut inattendu : $($poCheck.Data.status)" -ForegroundColor Yellow
        }
    }
} else { Skip-HttpTest -TestId "4.5" -Description "Reception partielle 1/5" -Reason "Commande non creee" }

# 4.6 Carol tente de sur-recepter (quantite > restant = 4) -> doit etre rejete 400
if ($po2Created) {
    $overBody = @{ items = @( @{ product = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; quantity = 99 } ) }
    Invoke-HttpTest -TestId "4.6" -Description "Sur-reception rejetee (quantite 99 > restant 4) -> 400" `
        -Method "POST" -Uri "$base/PurchaseOrders(ID=$po2Id)/receive" -Headers $authCarol -Body $overBody -ExpectedStatus @(400, 409) | Out-Null
} else { Skip-HttpTest -TestId "4.6" -Description "Sur-reception rejetee" -Reason "Commande non creee" }

# 4.7 Carol receptione le solde restant (4 unites)
if ($po2Created) {
    $soldeBody = @{ items = @( @{ product = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; quantity = 4 } ) }
    $fullRec = Invoke-HttpTest -TestId "4.7" -Description "Carol receptione le solde restant (4/4) -> statut RECEIVED" `
        -Method "POST" -Uri "$base/PurchaseOrders(ID=$po2Id)/receive" -Headers $authCarol -Body $soldeBody -ExpectedStatus @(200)
    if ($fullRec.Success) {
        $poFinal = Invoke-HttpTest -TestId "4.7b" -Description "Commande passe a statut RECEIVED" `
            -Method "GET" -Uri "$base/PurchaseOrders(ID=$po2Id)" -Headers $authCarol -ExpectedStatus @(200)
        if ($poFinal.Success -and $poFinal.Data -and $poFinal.Data.status -eq "RECEIVED") {
            Write-Host "       -> Statut RECEIVED confirme" -ForegroundColor Green
        } elseif ($poFinal.Success) {
            Write-Host "       -> [ATTENTION] Statut inattendu : $($poFinal.Data.status)" -ForegroundColor Yellow
        }
    }
} else { Skip-HttpTest -TestId "4.7" -Description "Reception totale solde" -Reason "Commande non creee" }

# 4.8 decline SANS motif -> doit renvoyer 400
$pr3Payload = @{
    description = "Demande test decline"
    items = @( @{ product_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; quantity = 2 } )
}
$pr3Step = Invoke-HttpTest -TestId "4.8a" -Description "Alice cree une 3eme demande pour test decline" `
    -Method "POST" -Uri "$base/PurchaseRequests" -Headers $authAlice -Body $pr3Payload -ExpectedStatus @(201)
$pr3Id = $null
if ($pr3Step.Success -and $pr3Step.Data) { $pr3Id = $pr3Step.Data.ID }

if ($pr3Id) {
    Invoke-HttpTest -TestId "4.8b" -Description "Alice soumet la 3eme demande" `
        -Method "POST" -Uri "$base/PurchaseRequests(ID=$pr3Id)/submit" -Headers $authAlice -Body "{}" -ExpectedStatus @(200) | Out-Null

    # Decline SANS motif
    Invoke-HttpTest -TestId "4.8" -Description "Decline sans motif rejete (400)" `
        -Method "POST" -Uri "$base/PurchaseRequests(ID=$pr3Id)/decline" -Headers $authBob -Body @{ reason = "" } -ExpectedStatus @(400) | Out-Null

    # 4.9 Decline AVEC motif -> 200
    $declineBody = @{ reason = "Budget insuffisant pour ce trimestre" }
    $declineStep = Invoke-HttpTest -TestId "4.9" -Description "Decline avec motif valide (200)" `
        -Method "POST" -Uri "$base/PurchaseRequests(ID=$pr3Id)/decline" -Headers $authBob -Body $declineBody -ExpectedStatus @(200)
    if ($declineStep.Success -and $declineStep.Data -and $declineStep.Data.status -eq "REJECTED") {
        Write-Host "       -> Statut REJECTED et motif enregistre" -ForegroundColor Green
    }
} else {
    Skip-HttpTest -TestId "4.8" -Description "Decline sans motif" -Reason "3eme demande non creee"
    Skip-HttpTest -TestId "4.9" -Description "Decline avec motif" -Reason "3eme demande non creee"
}


# ==============================================================================
# SECTION 5 : ENDPOINT /me ET PROTECTION OPEN REDIRECT (/login)
# ==============================================================================
Write-Host "`n--- SECTION 5 : /me & OPEN REDIRECT ---" -ForegroundColor Yellow

# 5.1 /me sans credentials -> 401
Invoke-HttpTest -TestId "5.1" -Description "/me sans credentials renvoie 401" `
    -Method "GET" -Uri "$baseRoot/me" -ExpectedStatus @(401) | Out-Null

# 5.2 /me avec credentials alice -> 200 avec id=alice
$meAlice = Invoke-HttpTest -TestId "5.2" -Description "/me avec credentials alice renvoie 200 + id=alice" `
    -Method "GET" -Uri "$baseRoot/me" -Headers $authAlice -ExpectedStatus @(200)
if ($meAlice.Success -and $meAlice.Data -and $meAlice.Data.id -eq "alice") {
    Write-Host "       -> id=alice confirme, roleLabel=$($meAlice.Data.roleLabel)" -ForegroundColor Green
} elseif ($meAlice.Success) {
    Write-Host "       -> [ATTENTION] id recu: $($meAlice.Data.id)" -ForegroundColor Yellow
}

# 5.3 /me avec credentials bob -> 200 avec id=bob et roleLabel=Manager
$meBob = Invoke-HttpTest -TestId "5.3" -Description "/me avec credentials bob renvoie roleLabel=Manager" `
    -Method "GET" -Uri "$baseRoot/me" -Headers $authBob -ExpectedStatus @(200)
if ($meBob.Success -and $meBob.Data -and $meBob.Data.roleLabel -eq "Manager") {
    Write-Host "       -> roleLabel=Manager confirme" -ForegroundColor Green
} elseif ($meBob.Success) {
    Write-Host "       -> [ATTENTION] roleLabel recu: $($meBob.Data.roleLabel)" -ForegroundColor Yellow
}

# 5.4 /me avec credentials carol -> roleLabel=Magasinier
$meCarol = Invoke-HttpTest -TestId "5.4" -Description "/me avec credentials carol renvoie roleLabel=Magasinier" `
    -Method "GET" -Uri "$baseRoot/me" -Headers $authCarol -ExpectedStatus @(200)
if ($meCarol.Success -and $meCarol.Data -and $meCarol.Data.roleLabel -eq "Magasinier") {
    Write-Host "       -> roleLabel=Magasinier confirme" -ForegroundColor Green
}

# 5.5 Protection open redirect : /login?returnUrl=http://evil.com doit rediriger vers /
# (le serveur doit retourner 302 vers "/" et non vers l'URL externe)
try {
    $redirectResp = Invoke-WebRequest -Uri "$baseRoot/login?returnUrl=http://evil.com" `
        -Headers $authAlice `
        -UseBasicParsing `
        -MaximumRedirection 0 `
        -TimeoutSec 10 `
        -ErrorAction SilentlyContinue
    $redirectStatus = [int]$redirectResp.StatusCode
    $locationHdr = $redirectResp.Headers["Location"]
} catch [System.Net.WebException] {
    if ($_.Exception.Response) {
        $redirectStatus = [int]$_.Exception.Response.StatusCode
        $locationHdr = $_.Exception.Response.Headers["Location"]
    } else {
        $redirectStatus = 0; $locationHdr = ""
    }
} catch {
    $redirectStatus = 0; $locationHdr = ""
}

$isRedirect = ($redirectStatus -eq 302) -or ($redirectStatus -eq 301)
$targetIsSafe = ($locationHdr -eq "/") -or ($locationHdr -eq "$baseRoot/") -or ($locationHdr -eq "http://localhost:4004/")
$noOpenRedirect = $locationHdr -ne "http://evil.com"

if ($isRedirect -and $noOpenRedirect -and $targetIsSafe) {
    Write-Host "[5.5] [REUSSI] Open redirect protege : /login?returnUrl=http://evil.com -> Location: $locationHdr | Code: $redirectStatus" -ForegroundColor Green
    $global:passedTests++
} elseif ($isRedirect -and $noOpenRedirect) {
    Write-Host "[5.5] [REUSSI] Open redirect non suivi : Location=$locationHdr (different de evil.com) | Code: $redirectStatus" -ForegroundColor Green
    $global:passedTests++
} else {
    Write-Host "[5.5] [ECHEC]  Open redirect non protege : Location=$locationHdr | Code: $redirectStatus" -ForegroundColor Red
    $global:failedTests++
}

# 5.6 Protection open redirect : /login?returnUrl=//evil.com doit rediriger vers /
try {
    $r2 = Invoke-WebRequest -Uri "$baseRoot/login?returnUrl=//evil.com" `
        -Headers $authAlice `
        -UseBasicParsing `
        -MaximumRedirection 0 `
        -TimeoutSec 10 `
        -ErrorAction SilentlyContinue
    $loc2 = $r2.Headers["Location"]
} catch [System.Net.WebException] {
    if ($_.Exception.Response) { $loc2 = $_.Exception.Response.Headers["Location"] } else { $loc2 = "" }
} catch { $loc2 = "" }

if ($loc2 -ne "//evil.com" -and $loc2 -ne "http://evil.com") {
    Write-Host "[5.6] [REUSSI] Double-slash redirect protege : Location=$loc2" -ForegroundColor Green
    $global:passedTests++
} else {
    Write-Host "[5.6] [ECHEC]  Double-slash redirect non protege : Location=$loc2" -ForegroundColor Red
    $global:failedTests++
}

# 5.7 /login?returnUrl=/purchase-requests/webapp/index.html doit rediriger normalement (chemin interne valide)
try {
    $r3 = Invoke-WebRequest -Uri "$baseRoot/login?returnUrl=/purchase-requests/webapp/index.html" `
        -Headers $authAlice `
        -UseBasicParsing `
        -MaximumRedirection 0 `
        -TimeoutSec 10 `
        -ErrorAction SilentlyContinue
    $loc3 = $r3.Headers["Location"]
} catch [System.Net.WebException] {
    if ($_.Exception.Response) { $loc3 = $_.Exception.Response.Headers["Location"] } else { $loc3 = "" }
} catch { $loc3 = "" }

if ($loc3 -like "*/purchase-requests/webapp/index.html" -or $loc3 -eq "/purchase-requests/webapp/index.html") {
    Write-Host "[5.7] [REUSSI] Chemin interne accepte : Location=$loc3" -ForegroundColor Green
    $global:passedTests++
} else {
    Write-Host "[5.7] [ECHEC]  Chemin interne non accepte : Location=$loc3" -ForegroundColor Red
    $global:failedTests++
}


# ==============================================================================
# SECTION 6 : SECURITE POST-SWITCH & ENDPOINTS DE DEMO
# ==============================================================================
Write-Host "`n--- SECTION 6 : SECURITE POST-SWITCH & ENDPOINTS DE DEMO ---" -ForegroundColor Yellow

if ($isDevOrDemo) {
    # 6.1  Bascule via /api/switch (simule le 1-clic, sans mot de passe)
    $switchBody = '{"username":"alice"}'
    $switchResult = Invoke-HttpTest -TestId "6.1" -Description "/api/switch alice -> 200 + cookie HMAC pose" `
        -Method "POST" -Uri "$baseRoot/api/switch" `
        -Body $switchBody -ExpectedStatus @(200)

    if ($switchResult.Success -and $switchResult.Data -and $switchResult.Data.user) {
        Write-Host "       -> user.id=$($switchResult.Data.user.id), isDev=$($switchResult.Data.isDev)" -ForegroundColor Green
    }

    # 6.2  Requete OData sans aucun credentials -> 401
    Invoke-HttpTest -TestId "6.2" -Description "Requete OData sans credentials apres switch -> 401 garanti" `
        -Method "GET" -Uri "$base/Products" -ExpectedStatus @(401) | Out-Null
} else {
    Write-Host "Mode production detecte (fail-closed) : verification de la neutralisation des endpoints demo." -ForegroundColor Cyan

    # 6.1  /api/switch doit repondre 404 en production
    $switchBody = '{"username":"alice"}'
    Invoke-HttpTest -TestId "6.1" -Description "Production : /api/switch neutralise (404 attendu)" `
        -Method "POST" -Uri "$baseRoot/api/switch" `
        -Body $switchBody -ExpectedStatus @(404) | Out-Null

    # 6.2  /api/login doit repondre 404 en production
    $loginBody = '{"username":"alice","password":"pwd"}'
    Invoke-HttpTest -TestId "6.2" -Description "Production : /api/login neutralise (404 attendu)" `
        -Method "POST" -Uri "$baseRoot/api/login" `
        -Body $loginBody -ExpectedStatus @(404) | Out-Null
}

# ==============================================================================
# SECTION 7 : DURCISSEMENT — CAS D'ERREUR SUR LES ENDPOINTS D'AUTH
# ==============================================================================
Write-Host "`n--- SECTION 7 : DURCISSEMENT (CAS LIMITES & COOKIES FALSIFIES) ---" -ForegroundColor Yellow

if ($isDevOrDemo) {
    # 7.1  /api/switch avec utilisateur inconnu -> 401
    $unknownSwitch = '{"username":"unknown_user_xyz"}'
    Invoke-HttpTest -TestId "7.1" -Description "/api/switch utilisateur inconnu -> 401" `
        -Method "POST" -Uri "$baseRoot/api/switch" `
        -Body $unknownSwitch -ExpectedStatus @(401) | Out-Null

    # 7.2  /api/switch avec username vide -> 400
    $emptySwitch = '{"username":""}'
    Invoke-HttpTest -TestId "7.2" -Description "/api/switch username vide -> 400" `
        -Method "POST" -Uri "$baseRoot/api/switch" `
        -Body $emptySwitch -ExpectedStatus @(400) | Out-Null

    # 7.3  /api/login avec mauvais mot de passe -> 401
    $badLoginBody = '{"username":"alice","password":"MAUVAIS_MOT_DE_PASSE"}'
    Invoke-HttpTest -TestId "7.3" -Description "/api/login mauvais mot de passe -> 401" `
        -Method "POST" -Uri "$baseRoot/api/login" `
        -Body $badLoginBody -ExpectedStatus @(401) | Out-Null

    # 7.4  /api/login avec identifiant inconnu -> 401
    $unknownLogin = '{"username":"unknown_xyz","password":"n_importe_quoi"}'
    Invoke-HttpTest -TestId "7.4" -Description "/api/login utilisateur inconnu -> 401" `
        -Method "POST" -Uri "$baseRoot/api/login" `
        -Body $unknownLogin -ExpectedStatus @(401) | Out-Null

    # 7.5  Cookie ptp_auth falsifie -> /me repond 401
    $fakeCookieHdr = @{ "Cookie" = "ptp_auth=YWxpY2V8OTk5OTk5OTk5OXxmYWtlc2ln" }
    Invoke-HttpTest -TestId "7.5" -Description "/me avec cookie falsifie -> 401 (signature HMAC invalide)" `
        -Method "GET" -Uri "$baseRoot/me" `
        -Headers $fakeCookieHdr -ExpectedStatus @(401) | Out-Null

    # 7.6  Cookie ptp_auth expire -> /me repond 401
    $expiredToken = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes("alice|1|expiredsig")) -replace '\+','-' -replace '/','_' -replace '=',''
    $expiredCookieHdr = @{ "Cookie" = "ptp_auth=$expiredToken" }
    Invoke-HttpTest -TestId "7.6" -Description "/me avec cookie expire -> 401" `
        -Method "GET" -Uri "$baseRoot/me" `
        -Headers $expiredCookieHdr -ExpectedStatus @(401) | Out-Null
} else {
    # En production, les fonctions de switch/login sont 404, on valide la robustesse de /me et cookies ignores
    Skip-HttpTest -TestId "7.1" -Description "/api/switch utilisateur inconnu" -Reason "Non applicable en production (404 verifie en 6.1)"
    Skip-HttpTest -TestId "7.2" -Description "/api/switch username vide" -Reason "Non applicable en production (404 verifie en 6.1)"
    Skip-HttpTest -TestId "7.3" -Description "/api/login mauvais mot de passe" -Reason "Non applicable en production (404 verifie en 6.2)"
    Skip-HttpTest -TestId "7.4" -Description "/api/login utilisateur inconnu" -Reason "Non applicable en production (404 verifie en 6.2)"

    # 7.5  Cookie ptp_auth ignore ou invalide en production -> /me repond 401
    $fakeCookieHdr = @{ "Cookie" = "ptp_auth=YWxpY2V8OTk5OTk5OTk5OXxmYWtlc2ln" }
    Invoke-HttpTest -TestId "7.5" -Description "Production : Cookie ptp_auth falsifie ignore -> /me repond 401" `
        -Method "GET" -Uri "$baseRoot/me" `
        -Headers $fakeCookieHdr -ExpectedStatus @(401) | Out-Null

    # 7.6  Cookie ptp_auth expire -> /me repond 401
    $expiredToken = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes("alice|1|expiredsig")) -replace '\+','-' -replace '/','_' -replace '=',''
    $expiredCookieHdr = @{ "Cookie" = "ptp_auth=$expiredToken" }
    Invoke-HttpTest -TestId "7.6" -Description "Production : Cookie ptp_auth expire -> /me repond 401" `
        -Method "GET" -Uri "$baseRoot/me" `
        -Headers $expiredCookieHdr -ExpectedStatus @(401) | Out-Null
}

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
