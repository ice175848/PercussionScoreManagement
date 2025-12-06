import 'package:flutter/foundation.dart';

import '../../../domain/entities/instrument.dart';
import '../../../domain/entities/part.dart';
import '../../../domain/entities/score_piece.dart';

/// 管理所有曲目的清單與基本操作（新增／刪除／更新）
class PieceListProvider extends ChangeNotifier {
  final List<ScorePiece> _pieces = [];

  List<ScorePiece> get pieces => List.unmodifiable(_pieces);

  PieceListProvider() {
    // 先放一些假資料，方便之後開發 UI
    _seedDemoData();
  }

  void _seedDemoData() {
    final part1 = Part(id: 'p1', name: 'Percussion 1', order: 1);
    final part2 = Part(id: 'p2', name: 'Percussion 2', order: 2);
    final timpani = Part(id: 't1', name: 'Timpani', order: 3);

    final snare = Instrument(id: 'i1', name: 'Snare Drum');
    final bass = Instrument(id: 'i2', name: 'Bass Drum');
    final cymbal = Instrument(id: 'i3', name: 'Cymbal');
    final glock = Instrument(id: 'i4', name: 'Glockenspiel');

    _pieces.add(
      ScorePiece(
        id: 'piece1',
        title: 'Demo Piece 1',
        composer: 'Composer A',
        parts: [part1, part2, timpani],
        instrumentsByPart: {
          part1.id: [snare, glock],
          part2.id: [bass, cymbal],
          timpani.id: [],
        },
      ),
    );
  }

  void addPiece(ScorePiece piece) {
    _pieces.add(piece);
    notifyListeners();
  }

  void removePiece(String id) {
    _pieces.removeWhere((p) => p.id == id);
    notifyListeners();
  }
}



