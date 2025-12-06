import 'package:flutter/material.dart';

import '../../../domain/entities/score_piece.dart';

class PieceDetailPage extends StatelessWidget {
  final ScorePiece piece;

  const PieceDetailPage({super.key, required this.piece});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(piece.title),
      ),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          if (piece.composer != null)
            Text('作曲：${piece.composer}', style: Theme.of(context).textTheme.bodyLarge),
          if (piece.arranger != null)
            Text('編曲：${piece.arranger}', style: Theme.of(context).textTheme.bodyLarge),
          const SizedBox(height: 12),
          Text(
            '分部與樂器清單',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          ...piece.parts.map((part) {
            final instruments = piece.instrumentsByPart[part.id] ?? [];
            return Card(
              margin: const EdgeInsets.symmetric(vertical: 4),
              child: Padding(
                padding: const EdgeInsets.all(8.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      part.name,
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                    const SizedBox(height: 4),
                    if (instruments.isEmpty)
                      const Text('（尚未設定樂器）')
                    else
                      Wrap(
                        spacing: 4,
                        children: [
                          for (final inst in instruments)
                            Chip(
                              label: Text(inst.name),
                            ),
                        ],
                      ),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
}



