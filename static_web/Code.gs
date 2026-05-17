// ===== 打擊樂譜管理系統 — Google Apps Script 後端 =====
// 此腳本為中央 API，所有使用者共用同一份腳本。
// 前端透過 sheetId 參數指定要操作哪一份試算表。
//
// 架構：
//   第一張工作表 = 樂器庫（名稱固定為「樂器庫」）
//   第二張工作表 = 演奏者名冊（名稱固定為「演奏者」）
//   第三張以後的工作表 = 各場演出（工作表名稱 = 演出名稱）
//   每場演出的標頭列：title | composer | arranger | part_name | player_name | instrument_name | instrument_remark

var INST_SHEET_NAME = '樂器庫';
var PLAYER_SHEET_NAME = '演奏者';

// 預設樂器清單（INIT 時若樂器庫為空會自動匯入）
var DEFAULT_INSTRUMENTS = [
  'Timpani', 'Drumset',
  'Bongo', 'Conga', 'Tom-Tom', 'Floor Tom', 'Snare Drum', 'Bass Drum',
  'Suspend Cymbal', 'Crash Cymbals', 'Hi-hats', 'Ride Cymbal',
  'Triangle', 'Tambourine', 'Cowbell', 'Claves', 'Guiro', 'Cabasa',
  'Shaker', 'Sleigh Bell', 'Wind Chimes', 'Bells',
  'Xylophone', 'Marimba', 'Vibraphone', 'Chimes'
];

// 每場演出工作表的標頭（7 欄）
var PERF_HEADERS = ['title', 'composer', 'arranger', 'part_name', 'player_name', 'instrument_name', 'instrument_remark'];

// ========== 工具函式 ==========

function openSS_(sheetId) {
  if (!sheetId) throw new Error('缺少 sheetId 參數');
  try {
    return SpreadsheetApp.openById(sheetId);
  } catch (e) {
    throw new Error('無法存取試算表。請確認共用設定已開啟為「知道連結的任何人均可編輯」。');
  }
}

// ========== INIT ==========

function initSpreadsheet_(ss) {
  // --- 1. 確保「樂器庫」工作表存在 ---
  var instSheet = ss.getSheetByName(INST_SHEET_NAME);
  if (!instSheet) {
    var allSheets = ss.getSheets();
    if (allSheets.length === 1 && allSheets[0].getLastRow() === 0) {
      instSheet = allSheets[0];
      instSheet.setName(INST_SHEET_NAME);
    } else {
      instSheet = ss.insertSheet(INST_SHEET_NAME, 0);
    }
  }

  // 確保標頭
  if (instSheet.getRange('A1').getValue().toString().trim() !== '樂器名稱') {
    instSheet.getRange('A1').setValue('樂器名稱');
    instSheet.setFrozenRows(1);
  }

  // 如果樂器庫是空的（只有標頭），匯入預設樂器
  if (instSheet.getLastRow() <= 1) {
    var defaultData = DEFAULT_INSTRUMENTS.map(function(name) { return [name]; });
    if (defaultData.length > 0) {
      instSheet.getRange(2, 1, defaultData.length, 1).setValues(defaultData);
    }
  }

  // --- 2. 確保「演奏者」工作表存在 ---
  var playerSheet = ss.getSheetByName(PLAYER_SHEET_NAME);
  if (!playerSheet) {
    playerSheet = ss.insertSheet(PLAYER_SHEET_NAME, 1);
  }
  if (playerSheet.getRange('A1').getValue().toString().trim() !== '演奏者姓名') {
    playerSheet.getRange('A1').setValue('演奏者姓名');
    playerSheet.setFrozenRows(1);
  }

  return { instSheet: instSheet, playerSheet: playerSheet };
}

// 取得或建立某場演出的工作表，並自動補齊缺失的標頭（向後相容）
function getOrCreatePerfSheet_(ss, perfName) {
  var name = String(perfName).trim();
  if (!name || name === INST_SHEET_NAME || name === PLAYER_SHEET_NAME) {
    throw new Error('無效的演出名稱');
  }

  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, PERF_HEADERS.length).setValues([PERF_HEADERS]);
    sheet.setFrozenRows(1);
  } else {
    // 檢查並補齊缺失的標頭
    var lastCol = sheet.getLastColumn();
    if (lastCol > 0) {
      var currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return h.toString().trim(); });
      var missingHeaders = [];
      for (var i = 0; i < PERF_HEADERS.length; i++) {
        if (currentHeaders.indexOf(PERF_HEADERS[i]) === -1) {
          missingHeaders.push(PERF_HEADERS[i]);
        }
      }
      if (missingHeaders.length > 0) {
        sheet.getRange(1, lastCol + 1, 1, missingHeaders.length).setValues([missingHeaders]);
      }
    }
  }

  return sheet;
}

// 讀取單欄名冊（跳過標頭）
function readSingleColumn_(sheet) {
  var result = [];
  if (!sheet) return result;
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    var val = values[i][0];
    if (val !== null && val !== undefined && val.toString().trim() !== '') {
      result.push(val.toString().trim());
    }
  }
  return result;
}

// ========== doGet ==========

function doGet(e) {
  var sheetId = e.parameter.sheetId;

  try {
    var ss = openSS_(sheetId);
    var sheets = initSpreadsheet_(ss);

    // 1. 讀取樂器庫
    var instruments = readSingleColumn_(sheets.instSheet);

    // 2. 讀取演奏者名冊
    var players = readSingleColumn_(sheets.playerSheet);

    // 3. 讀取所有演出工作表
    var allSheets = ss.getSheets();
    var rows = [];

    for (var s = 0; s < allSheets.length; s++) {
      var sheet = allSheets[s];
      var sheetName = sheet.getName();

      // 跳過系統表
      if (sheetName === INST_SHEET_NAME || sheetName === PLAYER_SHEET_NAME) continue;

      var values = sheet.getDataRange().getValues();
      if (values.length < 2) continue;

      var headers = values[0];
      for (var r = 1; r < values.length; r++) {
        var obj = {
          _row: r + 1,
          performance_name: sheetName
        };
        for (var c = 0; c < headers.length; c++) {
          if (headers[c]) obj[headers[c].toString().trim()] = values[r][c];
        }
        rows.push(obj);
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({ instruments: instruments, players: players, performances: rows }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ========== doPost ==========

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
      return ok_('INIT');
    }

    // 確保已初始化
    initSpreadsheet_(ss);

    // --- ADD_INSTRUMENT ---
    if (action === 'ADD_INSTRUMENT') {
      var instSheet = ss.getSheetByName(INST_SHEET_NAME);
      var instName = (data.instrument_name || '').toString().trim();
      if (instName && instSheet) {
        instSheet.appendRow([instName]);
      }
      return ok_('ADD_INSTRUMENT');
    }

    // --- ADD_PLAYER ---
    if (action === 'ADD_PLAYER') {
      var playerSheet = ss.getSheetByName(PLAYER_SHEET_NAME);
      var pName = (data.player_name || '').toString().trim();
      if (pName && playerSheet) {
        playerSheet.appendRow([pName]);
      }
      return ok_('ADD_PLAYER');
    }

    // --- CRUD 演出資料 ---
    var perfName = (data.performance_name || '').toString().trim();
    if (!perfName) throw new Error('缺少 performance_name');

    if (action === 'create') {
      var sheet = getOrCreatePerfSheet_(ss, perfName);
      var lastCol = sheet.getLastColumn();
      var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return h.toString().trim(); });
      var rowData = headers.map(function(h) { return data[h] !== undefined ? data[h] : ''; });
      sheet.appendRow(rowData);
      return ok_('create');

    } else if (action === 'batch_save') {
      var sheet = getOrCreatePerfSheet_(ss, perfName);
      var lastCol = sheet.getLastColumn();
      var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return h.toString().trim(); });
      
      // 1. Delete rows (must sort descending to not break indices)
      if (Array.isArray(data.delete_rows) && data.delete_rows.length > 0) {
        var sortedDeletes = data.delete_rows.map(function(r) { return parseInt(r); }).sort(function(a, b) { return b - a; });
        for (var i = 0; i < sortedDeletes.length; i++) {
          if (sortedDeletes[i] > 1) sheet.deleteRow(sortedDeletes[i]);
        }
      }
      
      // 2. Append new rows
      if (Array.isArray(data.create_rows) && data.create_rows.length > 0) {
        var newRows = [];
        for (var i = 0; i < data.create_rows.length; i++) {
          var rowObj = data.create_rows[i];
          var rowData = headers.map(function(h) { return rowObj[h] !== undefined ? rowObj[h] : ''; });
          newRows.push(rowData);
        }
        if (newRows.length > 0) {
          sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, lastCol).setValues(newRows);
        }
      }
      return ok_('batch_save');

    } else if (action === 'update') {
      var sheet = ss.getSheetByName(perfName);
      if (!sheet) throw new Error('找不到演出工作表：' + perfName);
      var rowIndex = parseInt(data.row_index);
      if (!rowIndex) throw new Error('Missing row_index');
      
      var lastCol = sheet.getLastColumn();
      var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return h.toString().trim(); });
      var rowData = headers.map(function(h) { return data[h] !== undefined ? data[h] : ''; });
      
      sheet.getRange(rowIndex, 1, 1, lastCol).setValues([rowData]);
      return ok_('update');
      
    } else if (action === 'update_remark') {
      var sheet = ss.getSheetByName(perfName);
      if (!sheet) throw new Error('找不到演出工作表：' + perfName);
      var rowIndexes = data.row_indexes;
      var remark = data.remark !== undefined ? data.remark : '';
      
      var lastCol = sheet.getLastColumn();
      var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return h.toString().trim(); });
      var colIdx = headers.indexOf('instrument_remark') + 1;
      
      if (colIdx > 0 && Array.isArray(rowIndexes)) {
        for (var i = 0; i < rowIndexes.length; i++) {
          var rIdx = parseInt(rowIndexes[i]);
          if (rIdx) {
            sheet.getRange(rIdx, colIdx).setValue(remark);
          }
        }
      }
      return ok_('update_remark');

    } else if (action === 'delete') {
      var sheet = ss.getSheetByName(perfName);
      if (!sheet) throw new Error('找不到演出工作表：' + perfName);
      var rowIndex = parseInt(data.row_index);
      if (!rowIndex) throw new Error('Missing row_index');
      sheet.deleteRow(rowIndex);
      return ok_('delete');
    }

    throw new Error('未知的 action: ' + action);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function ok_(action) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, action: action }))
    .setMimeType(ContentService.MimeType.JSON);
}
