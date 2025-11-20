<?php
// api/index.php

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit(0);
}

header('Content-Type: application/json; charset=utf-8');

$host = 'localhost';
$user = 'db_user';
$pass = 'db_pass';
$db   = 'db_name';

$mysqli = @new mysqli($host, $user, $pass, $db);

if ($mysqli->connect_errno) {
    echo json_encode([
        'success' => false,
        'error'   => 'Database connection failed'
    ]);
    exit;
}

$mysqli->set_charset('utf8mb4');

$allowedTables = [
    'pky_transactions',
    'pky_liquidity',
    'pky_portfolios',
    'pky_asset_types',
    'pky_allocation_targets',
];

$table = isset($_GET['table']) ? $_GET['table'] : null;

if (!$table || !in_array($table, $allowedTables, true)) {
    echo json_encode([
        'success' => false,
        'error'   => 'Invalid or missing table'
    ]);
    $mysqli->close();
    exit;
}

function getTableColumns(mysqli $db, string $table): array
{
    $columns = [];
    $result = $db->query("SHOW COLUMNS FROM `$table`");
    if ($result) {
        while ($row = $result->fetch_assoc()) {
            $columns[] = $row['Field'];
        }
        $result->free();
    }
    return $columns;
}

function getParamTypes(array $values): string
{
    $types = '';
    foreach ($values as $val) {
        if (is_int($val)) {
            $types .= 'i';
        } elseif (is_float($val) || (is_string($val) && is_numeric($val))) {
            $types .= 'd';
        } else {
            $types .= 's';
        }
    }
    return $types;
}

function filterDataByColumns(array $data, array $columns, bool $includeId = false): array
{
    $allowed = [];
    foreach ($data as $key => $value) {
        if (!$includeId && $key === 'id') {
            continue;
        }
        if (in_array($key, $columns, true)) {
            $allowed[$key] = $value;
        }
    }
    return $allowed;
}

function insertRow(mysqli $db, string $table, array $data, array $columns)
{
    $filtered = filterDataByColumns($data, $columns, false);
    if (empty($filtered)) {
        return ['success' => false, 'error' => 'No valid fields for insert'];
    }

    $fields = array_keys($filtered);
    $placeholders = implode(',', array_fill(0, count($fields), '?'));
    $sql = "INSERT INTO `$table` (`" . implode('`,`', $fields) . "`) VALUES ($placeholders)";
    $stmt = $db->prepare($sql);

    if (!$stmt) {
        return ['success' => false, 'error' => 'Prepare failed: ' . $db->error];
    }

    $values = array_values($filtered);
    $types = getParamTypes($values);
    $stmt->bind_param($types, ...$values);

    if (!$stmt->execute()) {
        $error = $stmt->error;
        $stmt->close();
        return ['success' => false, 'error' => 'Insert failed: ' . $error];
    }

    $insertId = $stmt->insert_id;
    $stmt->close();

    return ['success' => true, 'id' => $insertId];
}

function updateRow(mysqli $db, string $table, array $data, array $columns)
{
    if (!isset($data['id'])) {
        return ['success' => false, 'error' => 'Missing id for update'];
    }

    $id = (int)$data['id'];
    unset($data['id']);

    $filtered = filterDataByColumns($data, $columns, false);
    if (empty($filtered)) {
        return ['success' => false, 'error' => 'No valid fields for update'];
    }

    $fields = array_keys($filtered);
    $sets = [];
    foreach ($fields as $field) {
        $sets[] = "`$field` = ?";
    }
    $sql = "UPDATE `$table` SET " . implode(', ', $sets) . " WHERE `id` = ?";
    $stmt = $db->prepare($sql);

    if (!$stmt) {
        return ['success' => false, 'error' => 'Prepare failed: ' . $db->error];
    }

    $values = array_values($filtered);
    $values[] = $id;
    $types = getParamTypes($values);
    $stmt->bind_param($types, ...$values);

    if (!$stmt->execute()) {
        $error = $stmt->error;
        $stmt->close();
        return ['success' => false, 'error' => 'Update failed: ' . $error];
    }

    $affected = $stmt->affected_rows;
    $stmt->close();

    return ['success' => true, 'affectedRows' => $affected];
}

$columns = getTableColumns($mysqli, $table);

if (empty($columns)) {
    echo json_encode([
        'success' => false,
        'error'   => 'Unable to read table metadata'
    ]);
    $mysqli->close();
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $response = ['success' => true];

    if (isset($_GET['id'])) {
        $id = (int)$_GET['id'];
        $stmt = $mysqli->prepare("SELECT * FROM `$table` WHERE `id` = ?");
        if (!$stmt) {
            echo json_encode(['success' => false, 'error' => 'Prepare failed: ' . $mysqli->error]);
            $mysqli->close();
            exit;
        }
        $stmt->bind_param('i', $id);
        if (!$stmt->execute()) {
            $error = $stmt->error;
            $stmt->close();
            echo json_encode(['success' => false, 'error' => 'Query failed: ' . $error]);
            $mysqli->close();
            exit;
        }
        $result = $stmt->get_result();
        $row = $result->fetch_assoc();
        $stmt->close();
        $response['data'] = $row ?: null;
    } else {
        $result = $mysqli->query("SELECT * FROM `$table`");
        if (!$result) {
            echo json_encode(['success' => false, 'error' => 'Query failed: ' . $mysqli->error]);
            $mysqli->close();
            exit;
        }
        $rows = [];
        while ($row = $result->fetch_assoc()) {
            $rows[] = $row;
        }
        $result->free();
        $response['data'] = $rows;
    }

    echo json_encode($response);
    $mysqli->close();
    exit;
}

if ($method === 'POST') {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);

    if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
        echo json_encode([
            'success' => false,
            'error'   => 'Invalid JSON payload'
        ]);
        $mysqli->close();
        exit;
    }

    if (is_array($data) && isset($data[0]) && is_array($data[0])) {
        $mysqli->begin_transaction();
        $results = [];
        $allOk = true;

        foreach ($data as $item) {
            if (!is_array($item)) {
                $allOk = false;
                $results[] = ['success' => false, 'error' => 'Invalid item format in bulk payload'];
                break;
            }

            if (isset($item['id'])) {
                $res = updateRow($mysqli, $table, $item, $columns);
            } else {
                $res = insertRow($mysqli, $table, $item, $columns);
            }

            if (!$res['success']) {
                $allOk = false;
                $results[] = $res;
                break;
            }

            $results[] = $res;
        }

        if ($allOk) {
            $mysqli->commit();
        } else {
            $mysqli->rollback();
        }

        echo json_encode([
            'success' => $allOk,
            'results' => $results
        ]);
        $mysqli->close();
        exit;
    }

    if (is_array($data)) {
        if (isset($data['id'])) {
            $result = updateRow($mysqli, $table, $data, $columns);
        } else {
            $result = insertRow($mysqli, $table, $data, $columns);
        }

        echo json_encode($result);
        $mysqli->close();
        exit;
    }

    echo json_encode([
        'success' => false,
        'error'   => 'Payload must be a JSON object or array of objects'
    ]);
    $mysqli->close();
    exit;
}

if ($method === 'DELETE') {
    if (isset($_GET['confirm']) && $_GET['confirm'] === 'all') {
        $sql = "TRUNCATE TABLE `$table`";
        if ($mysqli->query($sql)) {
            echo json_encode(['success' => true, 'action' => 'truncate']);
        } else {
            echo json_encode([
                'success' => false,
                'error'   => 'Truncate failed: ' . $mysqli->error
            ]);
        }
        $mysqli->close();
        exit;
    }

    if (isset($_GET['id'])) {
        $id = (int)$_GET['id'];
        $stmt = $mysqli->prepare("DELETE FROM `$table` WHERE `id` = ?");
        if (!$stmt) {
            echo json_encode([
                'success' => false,
                'error'   => 'Prepare failed: ' . $mysqli->error
            ]);
            $mysqli->close();
            exit;
        }
        $stmt->bind_param('i', $id);
        if (!$stmt->execute()) {
            $error = $stmt->error;
            $stmt->close();
            echo json_encode([
                'success' => false,
                'error'   => 'Delete failed: ' . $error
            ]);
            $mysqli->close();
            exit;
        }
        $affected = $stmt->affected_rows;
        $stmt->close();

        echo json_encode([
            'success'      => true,
            'affectedRows' => $affected
        ]);
        $mysqli->close();
        exit;
    }

    echo json_encode([
        'success' => false,
        'error'   => 'Missing id or confirm=all for DELETE'
    ]);
    $mysqli->close();
    exit;
}

http_response_code(405);
echo json_encode([
    'success' => false,
    'error'   => 'Method not allowed'
]);
$mysqli->close();
exit;
