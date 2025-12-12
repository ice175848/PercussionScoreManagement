import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../domain/entities/performance.dart';
import '../providers/piece_list_provider.dart';
import 'piece_list_page.dart';
import 'piece_create_row_page.dart';

class PerformanceListPage extends StatelessWidget {
  const PerformanceListPage({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<PieceListProvider>();
    final performances = provider.performances;

    return Scaffold(
      appBar: AppBar(
        title: const Text('選取表演'),
      ),
      body: Builder(
        builder: (context) {
          if (provider.isLoading) {
            return const Center(child: CircularProgressIndicator());
          }

          if (provider.errorMessage != null && performances.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      provider.errorMessage!,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 12),
                    ElevatedButton(
                      onPressed: () => provider.loadFromRemote(),
                      child: const Text('重試'),
                    ),
                  ],
                ),
              ),
            );
          }

          if (performances.isEmpty) {
            return const Center(
              child: Text('目前尚無表演資料，請先新增一場表演與曲目。'),
            );
          }

          return ListView.builder(
            itemCount: performances.length,
            itemBuilder: (context, index) {
              final perf = performances[index];
              return _PerformanceCard(performance: perf);
            },
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () async {
          final name = await _askPerformanceName(context);
          if (name == null || name.trim().isEmpty) return;

          // 新表演：先用這個表演名稱開第一筆資料（會在下一頁輸入曲目／分部／樂器）
          if (!context.mounted) return;
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => PieceCreateRowPage(performanceName: name.trim()),
            ),
          );
        },
        tooltip: '新增表演與曲目',
        child: const Icon(Icons.add),
      ),
    );
  }

  Future<String?> _askPerformanceName(BuildContext context) async {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('新增表演'),
          content: TextField(
            controller: controller,
            decoration: const InputDecoration(
              labelText: '表演名稱（例如：2025 春季音樂會）',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('取消'),
            ),
            TextButton(
              onPressed: () =>
                  Navigator.of(context).pop(controller.text.trim()),
              child: const Text('確定'),
            ),
          ],
        );
      },
    );
  }
}

class _PerformanceCard extends StatelessWidget {
  final Performance performance;

  const _PerformanceCard({required this.performance});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: ListTile(
        title: Text(performance.name),
        subtitle: Text('曲目數量：${performance.pieces.length}'),
        onTap: () {
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => PieceListPage(
                performanceId: performance.id,
                performanceName: performance.name,
              ),
            ),
          );
        },
      ),
    );
  }
}


