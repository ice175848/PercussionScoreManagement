import 'instrument.dart';
import 'part.dart';

/// 一首曲子（或一份總譜）的核心資料
class ScorePiece {
  final String id;
  final String title; // 曲名
  final String? composer; // 作曲者
  final String? arranger; // 編曲者

  /// 該曲子的所有分部（Perc 1, Perc 2, Timpani...）
  final List<Part> parts;

  /// 每個分部在譜上需要的樂器清單
  ///
  /// key: 分部 id
  /// value: 該分部所需的樂器清單
  final Map<String, List<Instrument>> instrumentsByPart;

  const ScorePiece({
    required this.id,
    required this.title,
    this.composer,
    this.arranger,
    this.parts = const [],
    this.instrumentsByPart = const {},
  });
}



