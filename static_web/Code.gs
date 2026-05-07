// TODO：改成你自己的試算表 ID
const SPREADSHEET_ID = 'AKfycbxeCbGZX1Bt0qYHBCmd5K7MdryrVI6x5mZOWMcHjxwu353e2Il6ctea9EZ3xkkuCQo';

// 工作表設定
const DATA_SHEET_NAME = '工作表1'; // 演出資料所在的工作表名稱
const INST_SHEET_INDEX = 0;      // 全域樂器庫設定為第一張工作表 (索引為 0)

function getSpreadsheet_() {
  if (SPREADSHEET_ID) {
    try {
      return SpreadsheetApp.openById(SPREADSHEET_ID);
    } catch (e) {}
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getDataSheet_() {
  return getSpreadsheet_().getSheetByName(DATA_SHEET_NAME) || getSpreadsheet_().getSheets()[0];
}

function getInstSheet_() {
  return getSpreadsheet_().getSheets()[INST_SHEET_INDEX];
}

// 讀取資料
function doGet(e) {
  const ss = getSpreadsheet_();
  
  // 1. 讀取樂器庫 (第一張表)
  const instSheet = getInstSheet_();
  let instruments = [];
  if (instSheet) {
    const instValues = instSheet.getDataRange().getValues();
    // 假設第一列是標題，數據從第二列開始
    for (let i = 1; i < instValues.length; i++) {
      if (instValues[i][0]) instruments.push(instValues[i][0].toString().trim());
    }
  }

  // 2. 讀取演出資料
  const dataSheet = getDataSheet_();
  const values = dataSheet.getDataRange().getValues();
  let rows = [];
  
  if (values.length >= 2) {
    const headers = values[0];
    rows = values.slice(1).map((row, index) => {
      const obj = { _row: index + 2 }; 
      headers.forEach((h, i) => {
        if (h) obj[h] = row[i];
      });
      return obj;
    });
  }

  // 回傳整合格式：包含 instruments 與 performances
  const result = {
    instruments: instruments,
    performances: rows
  };

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// 處理 新增 / 修改 / 刪除
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const action = data.action || 'create';

  const lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    // 支援直接新增至獨立樂器庫工作表
    if (action === 'ADD_INSTRUMENT' || data.performance_name === '樂器標籤') {
      const instSheet = getInstSheet_();
      if (!instSheet) throw new Error('找不到樂器庫工作表');
      instSheet.appendRow([data.instrument_name]);
      
      return ContentService
        .createTextOutput(JSON.stringify({ success: true, action: 'ADD_INSTRUMENT' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const sheet = getDataSheet_();
    if (!sheet) throw new Error('找不到演出資料工作表');

    if (action === 'create') {
      const row = [
        data.performance_name || '',
        data.piece_id || '',
        data.title || '',
        data.composer || '',
        data.arranger || '',
        data.part_name || '',
        data.instrument_name || '',
        data.instrument_remark || ''
      ];
      sheet.appendRow(row);

    } else if (action === 'update') {
      const rowIndex = parseInt(data.row_index);
      if (!rowIndex) throw new Error('Missing row_index for update');
      
      const range = sheet.getRange(rowIndex, 1, 1, 8);
      range.setValues([[
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
      const rowIndex = parseInt(data.row_index);
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
