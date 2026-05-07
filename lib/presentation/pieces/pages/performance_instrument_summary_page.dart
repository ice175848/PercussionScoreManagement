import 'package:flutter/material.dart';

import '../../../domain/entities/performance.dart';

/// 顯示某一場表演底下「所有曲目」會用到的樂器總表。
class PerformanceInstrumentSummaryPage extends StatefulWidget {
  final Performance performance;

  const PerformanceInstrumentSummaryPage({
    super.key,
    required this.performance,
  });

  @override
  State<PerformanceInstrumentSummaryPage> createState() =>
      _PerformanceInstrumentSummaryPageState();
}

class _PerformanceInstrumentSummaryPageState
    extends State<PerformanceInstrumentSummaryPage> {
  bool _inventoryMode = false;
  final Set<String> _checkedInstruments = <String>{};

  void _toggleInventoryMode() {
    setState(() {
      _inventoryMode = !_inventoryMode;
    });
  }

  void _toggleChecked(String instrumentName) {
    setState(() {
      if (_checkedInstruments.contains(instrumentName)) {
        _checkedInstruments.remove(instrumentName);
      } else {
        _checkedInstruments.add(instrumentName);
      }
    });
  }

  void _checkAll(Iterable<String> instrumentNames) {
    setState(() {
      _checkedInstruments
        ..clear()
        ..addAll(instrumentNames);
    });
  }

  void _uncheckAll() {
    setState(() {
      _checkedInstruments.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final instrumentCountMap = <String, int>{};

    for (final piece in widget.performance.pieces) {
      for (final instruments in piece.instrumentsByPart.values) {
        for (final inst in instruments) {
          instrumentCountMap.update(inst.name, (value) => value + 1,
              ifAbsent: () => 1);
        }
      }
    }

    final entries = instrumentCountMap.entries.toList()
      ..sort((a, b) => a.key.compareTo(b.key));

    // 當資料刷新（例如重新載入）時，清掉不存在的清點項目，避免保留髒狀態
    final availableNames = entries.map((e) => e.key).toSet();
    _checkedInstruments.removeWhere((name) => !availableNames.contains(name));

    final totalCount = entries.length;
    final checkedCount =
        _checkedInstruments.where((n) => availableNames.contains(n)).length;
    final uncheckedCount = totalCount - checkedCount;

    return Scaffold(
      appBar: AppBar(
        title: Text('樂器總覽 - ${widget.performance.name}'),
        actions: [
          IconButton(
            tooltip: _inventoryMode ? '離開清點模式' : '進入清點模式',
            icon: Icon(_inventoryMode ? Icons.checklist : Icons.checklist_rtl),
            onPressed: _toggleInventoryMode,
          ),
          if (_inventoryMode)
            PopupMenuButton<String>(
              tooltip: '清點操作',
              onSelected: (value) {
                switch (value) {
                  case 'check_all':
                    _checkAll(availableNames);
                    return;
                  case 'uncheck_all':
                    _uncheckAll();
                    return;
                  case 'reset_mode':
                    _uncheckAll();
                    return;
                }
              },
              itemBuilder: (context) => [
                PopupMenuItem(
                  value: 'check_all',
                  enabled: entries.isNotEmpty,
                  child: Text('全部設為已清點（$totalCount）'),
                ),
                PopupMenuItem(
                  value: 'uncheck_all',
                  enabled: _checkedInstruments.isNotEmpty,
                  child: const Text('全部設為未清點'),
                ),
                const PopupMenuDivider(),
                const PopupMenuItem(
                  value: 'reset_mode',
                  child: Text('重設清點（清空勾選）'),
                ),
              ],
            ),
        ],
      ),
      body: entries.isEmpty
          ? const Center(
              child: Text('此場表演目前尚未設定任何樂器。'),
            )
          : Column(
              children: [
                _InventorySummaryBar(
                  inventoryMode: _inventoryMode,
                  totalCount: totalCount,
                  checkedCount: checkedCount,
                  uncheckedCount: uncheckedCount,
                  onCheckAll: () => _checkAll(availableNames),
                  onUncheckAll: _uncheckAll,
                ),
                const Divider(height: 1),
                Expanded(
                  child: ListView.builder(
                    itemCount: entries.length,
                    itemBuilder: (context, index) {
                      final entry = entries[index];
                      final name = entry.key;
                      final isChecked = _checkedInstruments.contains(name);

                      if (_inventoryMode) {
                        return CheckboxListTile(
                          value: isChecked,
                          onChanged: (_) => _toggleChecked(name),
                          secondary: const Icon(Icons.music_note),
                          title: Text(name),
                          subtitle: entry.value > 1 ? Text('數量：x${entry.value}') : null,
                          controlAffinity: ListTileControlAffinity.trailing,
                        );
                      }

                      return ListTile(
                        leading: const Icon(Icons.music_note),
                        title: Text(name),
                        trailing: entry.value > 1
                            ? Text('x${entry.value}')
                            : const SizedBox.shrink(),
                      );
                    },
                  ),
                ),
              ],
            ),
    );
  }
}

class _InventorySummaryBar extends StatelessWidget {
  final bool inventoryMode;
  final int totalCount;
  final int checkedCount;
  final int uncheckedCount;
  final VoidCallback onCheckAll;
  final VoidCallback onUncheckAll;

  const _InventorySummaryBar({
    required this.inventoryMode,
    required this.totalCount,
    required this.checkedCount,
    required this.uncheckedCount,
    required this.onCheckAll,
    required this.onUncheckAll,
  });

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      child: Row(
        children: [
          Expanded(
            child: Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                _CountChip(
                  label: '總數',
                  value: totalCount,
                  textTheme: textTheme,
                ),
                _CountChip(
                  label: '已清點',
                  value: checkedCount,
                  textTheme: textTheme,
                ),
                _CountChip(
                  label: '未清點',
                  value: uncheckedCount,
                  textTheme: textTheme,
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          if (inventoryMode) ...[
            TextButton(
              onPressed: totalCount == 0 ? null : onCheckAll,
              child: const Text('全選'),
            ),
            TextButton(
              onPressed: checkedCount == 0 ? null : onUncheckAll,
              child: const Text('重設'),
            ),
          ],
        ],
      ),
    );
  }
}

class _CountChip extends StatelessWidget {
  final String label;
  final int value;
  final TextTheme textTheme;

  const _CountChip({
    required this.label,
    required this.value,
    required this.textTheme,
  });

  @override
  Widget build(BuildContext context) {
    return Chip(
      label: Text(
        '$label：$value',
        style: textTheme.bodyMedium,
      ),
    );
  }
}


