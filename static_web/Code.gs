// ===== 打擊樂譜管理系統 — Google Apps Script 後端 =====
// 此腳本為中央 API，所有使用者共用同一份腳本，
// 前端透過 sheetId 參數指定要操作哪一份試算表。

// 樂器庫工作表名稱（固定）
const INST_SHEET_NAME = '樂器庫';
// 演出資料工作表名稱（固定）
const DATA_SHEET_NAME = '演出資料';

// ========== 工具函式 ==========

/**
 * 依 sheetId 開啟試算表
 */
function openSS_(sheetId) {
  if (!sheetId) throw new Error('缺少 sheetId 參數');
  try {
    return SpreadsheetApp.openById(sheetId);
  } catch (e) {
    throw new Error('無法存取試算表 (' + sheetId + ')。請確認共用設定已開啟為「知道連結的任何人均可編輯」。');
  }
}

/**
 * 取得「樂器庫」工作表（依名稱查找）
 * 找不到則回傳 null
 */
function findInstSheet_(ss) {
  return ss.getSheetByName(INST_SHEET_NAME);
}

/**
 * 取得「演出資料」工作表（依名稱查找，或依標頭辨識）
 * 找不到則回傳 null
 */
function findDataSheet_(ss) {
  // 1. 依固定名稱
  var sheet = ss.getSheetByName(DATA_SHEET_NAME);
  if (sheet) return sheet;

  // 2. 舊版相容：名稱叫「工作表1」
  sheet = ss.getSheetByName('工作表1');
  if (sheet) return sheet;

  // 3. 遍歷所有表，找 A1 = performance_name 的
  var all = ss.getSheets();
  for (var i = 0; i < all.length; i++) {
    var val = all[i].getRange('A1').getValue().toString().trim();
    if (val === 'performance_name') return all[i];
  }

  return null;
}

// ========== INIT：自動建立 / 修正試算表結構 ==========

function initSpreadsheet_(ss) {
  // --- 1. 確保「樂器庫」工作表存在 ---
  var instSheet = findInstSheet_(ss);
  if (!instSheet) {
    instSheet = ss.insertSheet(INST_SHEET_NAME, 0);
  }
  // 確保有標頭
  if (instSheet.getRange('A1').getValue().toString().trim() !== '樂器名稱') {
    instSheet.getRange('A1').setValue('樂器名稱');
    instSheet.setFrozenRows(1);
  }

  // --- 2. 確保「演出資料」工作表存在 ---
  var dataSheet = findDataSheet_(ss);
  if (!dataSheet) {
    // 找一張非樂器庫的既有空白表來用（通常是新試算表預設的「工作表1」或「Sheet1」）
    var all = ss.getSheets();
    for (var i = 0; i < all.length; i++) {
      if (all[i].getName() !== INST_SHEET_NAME) {
        dataSheet = all[i];
        break;
      }
    }
    if (dataSheet) {
      dataSheet.setName(DATA_SHEET_NAME);
    } else {
      dataSheet = ss.insertSheet(DATA_SHEET_NAME);
    }
  }

  // 確保有標頭列
  if (dataSheet.getRange('A1').getValue().toString().trim() !== 'performance_name') {
    var headers = ['performance_name', 'piece_id', 'title', 'composer', 'arranger', 'part_name', 'instrument_name', 'instrument_remark'];
    // 如果表格裡已經有資料，在第一行前插入
    if (dataSheet.getLastRow() > 0 && dataSheet.getRange('A1').getValue().toString().trim() !== '') {
      dataSheet.insertRowBefore(1);
    }
    dataSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    dataSheet.setFrozenRows(1);
  }

  return { instSheet: instSheet, dataSheet: dataSheet };
}

// ========== doGet：讀取資料 ==========

function doGet(e) {
  var sheetId = e.parameter.sheetId;

  try {
    var ss = openSS_(sheetId);

    // 先嘗試自動初始化（冪等操作，已存在的不會重複建立）
    var sheets = initSpreadsheet_(ss);

    // 1. 讀取樂器庫
    var instSheet = sheets.instSheet;
    var instruments = [];
    var instValues = instSheet.getDataRange().getValues();
    for (var i = 1; i < instValues.length; i++) {
      var name = instValues[i][0];
      if (name !== null && name !== undefined && name.toString().trim() !== '') {
        instruments.push(name.toString().trim());
      }
    }

    // 2. 讀取演出資料
    var dataSheet = sheets.dataSheet;
    var values = dataSheet.getDataRange().getValues();
    var rows = [];

    if (values.length >= 2) {
      var headers = values[0];
      for (var r = 1; r < values.length; r++) {
        var obj = { _row: r + 1 };
        for (var c = 0; c < headers.length; c++) {
          if (headers[c]) obj[headers[c]] = values[r][c];
        }
        rows.push(obj);
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({ instruments: instruments, performances: rows }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ========== doPost：寫入資料 ==========

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var action = data.action || 'create';
  var sheetId = data.sheetId;

  var lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    var ss = openSS_(sheetId);

    // --- INIT ---
    if (action === 'INIT') {
      initSpreadsheet_(ss);
      return ContentService
        .createTextOutput(JSON.stringify({ success: true, action: 'INIT' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 確保結構已初始化
    var sheets = initSpreadsheet_(ss);

    // --- ADD_INSTRUMENT：寫入樂器庫 ---
    if (action === 'ADD_INSTRUMENT') {
      var instName = (data.instrument_name || '').toString().trim();
      if (instName) {
        sheets.instSheet.appendRow([instName]);
      }
      return ContentService
        .createTextOutput(JSON.stringify({ success: true, action: 'ADD_INSTRUMENT' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // --- CRUD 演出資料 ---
    var sheet = sheets.dataSheet;

    if (action === 'create') {
      sheet.appendRow([
        data.performance_name || '',
        data.piece_id || '',
        data.title || '',
        data.composer || '',
        data.arranger || '',
        data.part_name || '',
        data.instrument_name || '',
        data.instrument_remark || ''
      ]);

    } else if (action === 'update') {
      var rowIndex = parseInt(data.row_index);
      if (!rowIndex) throw new Error('Missing row_index for update');
      sheet.getRange(rowIndex, 1, 1, 8).setValues([[
        data.performance_name || '',
        data.piece_id || '',
        data.title || '',
        data.composer || '',
        data.arranger || '',
        data.part_name || '',
        data.instrument_name || '',
        data.instrument_remark || ''
      ]]);

    } else if (action === 'delete') {
      var rowIndex = parseInt(data.row_index);
      if (!rowIndex) throw new Error('Missing row_index for delete');
      sheet.deleteRow(rowIndex);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, action: action }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
