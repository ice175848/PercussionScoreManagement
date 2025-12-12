import 'package:flutter/material.dart';

import '../../../domain/entities/score_piece.dart';

class PieceCard extends StatelessWidget {
  final ScorePiece piece;
  final VoidCallback? onTap;

  const PieceCard({
    super.key,
    required this.piece,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final parts = piece.parts;

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: ListTile(
        title: Text(piece.title),
        subtitle: Text(
          [
            if (piece.composer != null) '作曲：${piece.composer}',
            if (parts.isNotEmpty) '分部數量：${parts.length}',
          ].join(' · '),
        ),
        onTap: onTap,
      ),
    );
  }
}




