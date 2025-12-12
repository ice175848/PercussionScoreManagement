import 'package:flutter/material.dart';

import '../../../domain/entities/performance.dart';

/// 顯示某一場表演底下「所有曲目」會用到的樂器總表。
class PerformanceInstrumentSummaryPage extends StatelessWidget {
  final Performance performance;

  const PerformanceInstrumentSummaryPage({
    super.key,
    required this.performance,
  });

  @override
  Widget build(BuildContext context) {
    final instrumentCountMap = <String, int>{};

    for (final piece in performance.pieces) {
      for (final instruments in piece.instrumentsByPart.values) {
        for (final inst in instruments) {
          instrumentCountMap.update(inst.name, (value) => value + 1,
              ifAbsent: () => 1);
        }
      }
    }

    final entries = instrumentCountMap.entries.toList()
      ..sort((a, b) => a.key.compareTo(b.key));

    return Scaffold(
      appBar: AppBar(
        title: Text('樂器總覽 - ${performance.name}'),
      ),
      body: entries.isEmpty
          ? const Center(
              child: Text('此場表演目前尚未設定任何樂器。'),
            )
          : ListView.builder(
              itemCount: entries.length,
              itemBuilder: (context, index) {
                final entry = entries[index];
                return ListTile(
                  leading: const Icon(Icons.music_note),
                  title: Text(entry.key),
                  trailing: entry.value > 1
                      ? Text('x${entry.value}')
                      : const SizedBox.shrink(),
                );
              },
            ),
    );
  }
}


