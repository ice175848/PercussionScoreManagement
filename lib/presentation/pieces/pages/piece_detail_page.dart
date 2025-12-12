import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../domain/entities/instrument.dart';
import '../../../domain/entities/score_piece.dart';
import '../providers/piece_list_provider.dart';
import 'piece_create_row_page.dart';

class PieceDetailPage extends StatelessWidget {
  final String performanceId;
  final String performanceName;
  final String pieceId;

  const PieceDetailPage({
    super.key,
    required this.performanceId,
    required this.performanceName,
    required this.pieceId,
  });

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<PieceListProvider>();
    final performance = provider.performances.firstWhere(
      (p) => p.id == performanceId,
      orElse: () => provider.performances.firstWhere(
        (p) => p.name == performanceName,
        orElse: () => throw StateError('找不到指定的表演資料'),
      ),
    );

    final ScorePiece piece = performance.pieces.firstWhere(
      (p) => p.id == pieceId,
      orElse: () => throw StateError('找不到指定的曲目資料'),
    );

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(piece.title),
            Text(
              performanceName,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          if (piece.composer != null)
            Text(
              '作曲：${piece.composer}',
              style: Theme.of(context).textTheme.bodyLarge,
            ),
          if (piece.arranger != null)
            Text(
              '編曲：${piece.arranger}',
              style: Theme.of(context).textTheme.bodyLarge,
            ),
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
                            ActionChip(
                              label: Text(inst.name),
                              avatar: const Icon(Icons.edit, size: 16),
                              onPressed: () {
                                _showInstrumentOptions(
                                  context,
                                  piece: piece,
                                  partName: part.name,
                                  instrument: inst,
                                );
                              },
                            ),
                        ],
                      ),
                    const SizedBox(height: 4),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton.icon(
                        onPressed: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => PieceCreateRowPage(
                                performanceName: performanceName,
                                initialPiece: piece,
                              ),
                            ),
                          );
                        },
                        icon: const Icon(Icons.add),
                        label: const Text('新增此分部／樂器'),
                      ),
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

  void _showInstrumentOptions(
    BuildContext context, {
    required ScorePiece piece,
    required String partName,
    required Instrument instrument,
  }) {
    showModalBottomSheet(
      context: context,
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.edit),
                title: const Text('編輯'),
                onTap: () {
                  Navigator.of(context).pop(); // 關閉選單
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => PieceCreateRowPage(
                        performanceName: performanceName,
                        initialPiece: piece,
                        initialPartName: partName,
                        initialInstrument: instrument,
                      ),
                    ),
                  );
                },
              ),
              ListTile(
                leading: const Icon(Icons.delete, color: Colors.red),
                title: const Text('刪除', style: TextStyle(color: Colors.red)),
                onTap: () {
                  Navigator.of(context).pop(); // 關閉選單
                  _confirmDelete(context, instrument);
                },
              ),
            ],
          ),
        );
      },
    );
  }

  void _confirmDelete(BuildContext context, Instrument instrument) {
    if (instrument.rowIndex == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('無法刪除：找不到此樂器的列號資訊')),
      );
      return;
    }

    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('確認刪除'),
          content: Text('確定要刪除「${instrument.name}」嗎？'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('取消'),
            ),
            TextButton(
              onPressed: () async {
                Navigator.of(context).pop(); // 關閉對話框
                final provider = context.read<PieceListProvider>();
                try {
                  await provider.deletePieceRowAndReload(
                    rowIndex: instrument.rowIndex!,
                  );
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('刪除成功')),
                    );
                  }
                } catch (e) {
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('刪除失敗：$e')),
                    );
                  }
                }
              },
              child: const Text('刪除', style: TextStyle(color: Colors.red)),
            ),
          ],
        );
      },
    );
  }
}



