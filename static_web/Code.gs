// TODO：改成你自己的試算表 ID
const SPREADSHEET_ID = 'AKfycbxeCbGZX1Bt0qYHBCmd5K7MdryrVI6x5mZOWMcHjxwu353e2Il6ctea9EZ3xkkuCQo';

// 工作表設定
const DATA_SHEET_NAME = '工作表1'; // 演出資料所在的工作表名稱
const INST_SHEET_INDEX = 0;      // 全域樂器庫設定為第一張工作表 (索引為 0)

function getSpreadsheet_(customId) {
  const id = customId || SPREADSHEET_ID;
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      throw new Error("無法存取試算表。請確認您的試算表共用設定已開啟為「知道連結的任何人均可編輯」。");
    }
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getDataSheet_(customId) {
  return getSpreadsheet_(customId).getSheetByName(DATA_SHEET_NAME) || getSpreadsheet_(customId).getSheets()[0];
}

function getInstSheet_(customId) {
  return getSpreadsheet_(customId).getSheets()[INST_SHEET_INDEX];
}



// 讀取資料
function doGet(e) {
  const customId = e.parameter.sheetId;
  
  try {
    const ss = getSpreadsheet_(customId);
    
    // 1. 讀取樂器庫 (第一張表)
    const instSheet = getInstSheet_(customId);
  let instruments = [];
  if (instSheet) {
    const instValues = instSheet.getDataRange().getValues();
    // 檢查這是不是真的樂器庫 (透過檢查第一列表頭，如果是 performance_name 則代表這其實是資料表)
    if (instValues.length > 0 && instValues[0][0] && instValues[0][0].toString().trim() !== 'performance_name') {
      // 假設第一列是標題，數據從第二列開始
      for (let i = 1; i < instValues.length; i++) {
        if (instValues[i][0]) instruments.push(instValues[i][0].toString().trim());
      }
      }
    }

    // 2. 讀取演出資料
    const dataSheet = getDataSheet_(customId);
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
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// 處理 新增 / 修改 / 刪除
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const action = data.action || 'create';
  const customId = data.sheetId;

  const lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    if (action === 'INIT') {
      const ss = getSpreadsheet_(customId);
      let instSheet = ss.getSheetByName('樂器庫');
      let dataSheet = ss.getSheetByName(DATA_SHEET_NAME);
      
      // 1. 處理樂器庫
      if (!instSheet) {
        instSheet = ss.insertSheet('樂器庫', 0);
      }
      // 確保有標題
      if (!instSheet.getRange('A1').getValue()) {
        instSheet.getRange('A1').setValue('樂器名稱');
      }

      // 2. 處理資料表
      if (!dataSheet) {
        // 嘗試找尋預設的 Sheet1 或 工作表1 重新命名
        let defaultSheet = ss.getSheets().find(s => s.getName() === '工作表1' || s.getName() === 'Sheet1');
        if (defaultSheet) {
          defaultSheet.setName(DATA_SHEET_NAME);
          dataSheet = defaultSheet;
        } else {
          dataSheet = ss.insertSheet(DATA_SHEET_NAME, 1);
        }
      }
      
      // 寫入標題列 (如果第一列是空的)
      if (!dataSheet.getRange('A1').getValue()) {
        const headers = ['performance_name', 'piece_id', 'title', 'composer', 'arranger', 'part_name', 'instrument_name', 'instrument_remark'];
        dataSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        dataSheet.setFrozenRows(1);
      }

      return ContentService
        .createTextOutput(JSON.stringify({ success: true, action: 'INIT' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 支援直接新增至獨立樂器庫工作表
    // 必須確認第一張表確實是樂器庫，否則會寫錯地方
    if (action === 'ADD_INSTRUMENT' || data.performance_name === '樂器標籤') {
      const instSheet = getInstSheet_(customId);
      const checkVals = instSheet ? instSheet.getRange(1, 1).getValue().toString().trim() : '';
      
      // 如果只有一張表且它是資料表，我們就當作舊模式寫入資料表
      if (instSheet && checkVals !== 'performance_name') {
        instSheet.appendRow([data.instrument_name]);
        return ContentService
          .createTextOutput(JSON.stringify({ success: true, action: 'ADD_INSTRUMENT' }))
          .setMimeType(ContentService.MimeType.JSON);
      } else if (action === 'ADD_INSTRUMENT') {
        // 如果是舊版單一工作表模式 (第一欄是 performance_name)，我們需要將樂器寫入資料表中
        const sheet = getDataSheet_(customId);
        sheet.appendRow(['樂器標籤', '樂器表', '樂器表', '', '', '', data.instrument_name || '', '']);
        return ContentService
          .createTextOutput(JSON.stringify({ success: true, action: 'ADD_INSTRUMENT' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    const sheet = getDataSheet_(customId);
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
