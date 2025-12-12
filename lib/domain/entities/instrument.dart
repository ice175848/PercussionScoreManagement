/// 樂器實體：代表一個實際會出現在譜上的打擊樂器
class Instrument {
  final String id; // 內部用識別碼
  final String name; // 例如：Snare Drum, Bass Drum, Glockenspiel
  final String? remark; // 備註：如換槌、特殊技巧等
  
  /// 在 Google Sheet 上的列號 (用於修改/刪除)
  final int? rowIndex;

  const Instrument({
    required this.id,
    required this.name,
    this.remark,
    this.rowIndex,
  });
}



