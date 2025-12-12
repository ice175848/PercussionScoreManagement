import 'score_piece.dart';

/// 一場表演（音樂會／比賽等），底下包含多首曲目。
class Performance {
  final String id;
  final String name;

  /// 此場表演要演出的所有曲目。
  final List<ScorePiece> pieces;

  const Performance({
    required this.id,
    required this.name,
    this.pieces = const [],
  });

  Performance copyWith({
    String? id,
    String? name,
    List<ScorePiece>? pieces,
  }) {
    return Performance(
      id: id ?? this.id,
      name: name ?? this.name,
      pieces: pieces ?? this.pieces,
    );
  }
}


