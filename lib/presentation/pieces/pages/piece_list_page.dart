import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../domain/entities/performance.dart';
import '../providers/piece_list_provider.dart';
import '../widgets/piece_card.dart';
import 'piece_detail_page.dart';
import 'piece_create_row_page.dart';
import 'performance_instrument_summary_page.dart';

/// 顯示某一場表演底下的所有曲目清單。
class PieceListPage extends StatelessWidget {
  /// 使用表演的 id（目前等同於名稱）做為 key，
  /// 這樣當 Provider 重新載入資料時，此頁面會跟著更新。
  final String performanceId;
  final String performanceName;

  const PieceListPage({
    super.key,
    required this.performanceId,
    required this.performanceName,
  });

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<PieceListProvider>();
    final performance = provider.performances.firstWhere(
      (p) => p.id == performanceId,
      orElse: () => provider.performances.firstWhere(
        (p) => p.name == performanceName,
        orElse: () => Performance(
          id: performanceId,
          name: performanceName,
          pieces: const [],
        ),
      ),
    );

    final pieces = performance.pieces;

    return Scaffold(
      appBar: AppBar(
        title: Text('曲目清單 - ${performance.name}'),
        actions: [
          IconButton(
            icon: const Icon(Icons.list),
            tooltip: '本場演出樂器總覽',
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) =>
                      PerformanceInstrumentSummaryPage(performance: performance),
                ),
              );
            },
          ),
        ],
      ),
      body: pieces.isEmpty
          ? const Center(
              child: Text('這場表演目前尚未設定曲目。'),
            )
          : ListView.builder(
              itemCount: pieces.length,
              itemBuilder: (context, index) {
                final piece = pieces[index];
                return PieceCard(
                  piece: piece,
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => PieceDetailPage(
                          performanceId: performance.id,
                          performanceName: performance.name,
                          pieceId: piece.id,
                        ),
                      ),
                    );
                  },
                );
              },
            ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => PieceCreateRowPage(
                performanceName: performance.name,
              ),
            ),
          );
        },
        tooltip: '為此表演新增曲目／分部／樂器',
        child: const Icon(Icons.add),
      ),
    );
  }
}

