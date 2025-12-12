import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../domain/entities/instrument.dart';
import '../../../domain/entities/score_piece.dart';
import '../providers/piece_list_provider.dart';

/// 用來新增「一筆」樂譜資料：一場表演中的
/// 一首曲目 + 一個分部 + 一個樂器。
///
/// 如果一首曲子有多個分部／多種樂器，可以在這裡連續新增多筆。
class PieceCreateRowPage extends StatefulWidget {
  final String performanceName;
  
  /// 若為新增模式且已經知道曲目資訊，可傳入此物件預填
  final ScorePiece? initialPiece;

  /// 若為編輯模式，請傳入分部名稱與樂器物件（內含 rowIndex）
  final String? initialPartName;
  final Instrument? initialInstrument;

  const PieceCreateRowPage({
    super.key,
    required this.performanceName,
    this.initialPiece,
    this.initialPartName,
    this.initialInstrument,
  });

  @override
  State<PieceCreateRowPage> createState() => _PieceCreateRowPageState();
}

class _PieceCreateRowPageState extends State<PieceCreateRowPage> {
  final _formKey = GlobalKey<FormState>();

  final _pieceIdController = TextEditingController();
  final _titleController = TextEditingController();
  final _composerController = TextEditingController();
  final _arrangerController = TextEditingController();
  final _partNameController = TextEditingController();
  final _instrumentNameController = TextEditingController();
  final _instrumentRemarkController = TextEditingController();

  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    
    // 預填曲目資訊
    final piece = widget.initialPiece;
    if (piece != null) {
      _pieceIdController.text = piece.id;
      _titleController.text = piece.title;
      _composerController.text = piece.composer ?? '';
      _arrangerController.text = piece.arranger ?? '';
    }

    // 預填分部名稱
    if (widget.initialPartName != null) {
      _partNameController.text = widget.initialPartName!;
    }

    // 預填樂器資訊（編輯模式）
    final inst = widget.initialInstrument;
    if (inst != null) {
      _instrumentNameController.text = inst.name;
      _instrumentRemarkController.text = inst.remark ?? '';
    }
  }

  @override
  void dispose() {
    _pieceIdController.dispose();
    _titleController.dispose();
    _composerController.dispose();
    _arrangerController.dispose();
    _partNameController.dispose();
    _instrumentNameController.dispose();
    _instrumentRemarkController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      print('DEBUG: _submit form validation failed');
      return;
    }

    final provider = context.read<PieceListProvider>();

    setState(() {
      _submitting = true;
    });

    try {
      final rowIndex = widget.initialInstrument?.rowIndex;
      
      if (rowIndex != null) {
        print('DEBUG: _submit calling updatePieceRowAndReload for row $rowIndex');
        await provider.updatePieceRowAndReload(
          rowIndex: rowIndex,
          performanceName: widget.performanceName,
          pieceId: _pieceIdController.text.trim().isEmpty
              ? null
              : _pieceIdController.text.trim(),
          title: _titleController.text.trim(),
          composer: _composerController.text.trim().isEmpty
              ? null
              : _composerController.text.trim(),
          arranger: _arrangerController.text.trim().isEmpty
              ? null
              : _arrangerController.text.trim(),
          partName: _partNameController.text.trim(),
          instrumentName: _instrumentNameController.text.trim().isEmpty
              ? null
              : _instrumentNameController.text.trim(),
          instrumentRemark: _instrumentRemarkController.text.trim().isEmpty
              ? null
              : _instrumentRemarkController.text.trim(),
        );
      } else {
        print('DEBUG: _submit calling createPieceRowAndReload');
        await provider.createPieceRowAndReload(
          performanceName: widget.performanceName,
          pieceId: _pieceIdController.text.trim().isEmpty
              ? null
              : _pieceIdController.text.trim(),
          title: _titleController.text.trim(),
          composer: _composerController.text.trim().isEmpty
              ? null
              : _composerController.text.trim(),
          arranger: _arrangerController.text.trim().isEmpty
              ? null
              : _arrangerController.text.trim(),
          partName: _partNameController.text.trim(),
          instrumentName: _instrumentNameController.text.trim().isEmpty
              ? null
              : _instrumentNameController.text.trim(),
          instrumentRemark: _instrumentRemarkController.text.trim().isEmpty
              ? null
              : _instrumentRemarkController.text.trim(),
        );
      }
      print('DEBUG: _submit success');

      if (!mounted) return;
      Navigator.of(context).pop(); // 回到清單頁
    } catch (e) {
      print('DEBUG: _submit error: $e');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('新增失敗，請稍後再試。')),
      );
    } finally {
      if (mounted) {
        setState(() {
          _submitting = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isEditing = widget.initialInstrument?.rowIndex != null;
    final provider = context.watch<PieceListProvider>();

    // 建立所有現有分部與樂器名稱，當作 tag 建議
    final partTags = <String>{};
    final instrumentTags = <String>{};
    for (final perf in provider.performances) {
      for (final piece in perf.pieces) {
        for (final part in piece.parts) {
          partTags.add(part.name);
        }
        for (final instruments in piece.instrumentsByPart.values) {
          for (final inst in instruments) {
            instrumentTags.add(inst.name);
          }
        }
      }
    }

    final partFilter = _partNameController.text.trim();
    final instrumentFilter = _instrumentNameController.text.trim();

    final filteredPartTags = partTags
        .where((t) =>
            partFilter.isEmpty || t.toLowerCase().contains(partFilter.toLowerCase()))
        .toList()
      ..sort();
    final filteredInstrumentTags = instrumentTags
        .where((t) => instrumentFilter.isEmpty ||
            t.toLowerCase().contains(instrumentFilter.toLowerCase()))
        .toList()
      ..sort();

    return Scaffold(
      appBar: AppBar(
        title: Text(isEditing ? '編輯樂器' : '新增樂譜（單筆）'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            children: [
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  '表演：${widget.performanceName}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _pieceIdController,
                decoration: const InputDecoration(
                  labelText: '曲目 ID（可選，用來群組多筆資料）',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _titleController,
                decoration: const InputDecoration(
                  labelText: '曲名 *',
                  border: OutlineInputBorder(),
                ),
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return '請輸入曲名';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _composerController,
                decoration: const InputDecoration(
                  labelText: '作曲',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _arrangerController,
                decoration: const InputDecoration(
                  labelText: '編曲',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _partNameController,
                decoration: const InputDecoration(
                  labelText: '分部名稱 *（例如：Percussion 1）',
                  border: OutlineInputBorder(),
                ),
                onChanged: (_) => setState(() {}),
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return '請輸入分部名稱';
                  }
                  return null;
                },
              ),
              if (filteredPartTags.isNotEmpty) ...[
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    '已有分部標籤：',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
                const SizedBox(height: 4),
                Wrap(
                  spacing: 4,
                  children: [
                    for (final tag in filteredPartTags)
                      InputChip(
                        label: Text(tag),
                        onPressed: () {
                          setState(() {
                            _partNameController.text = tag;
                          });
                        },
                      ),
                  ],
                ),
              ],
              const SizedBox(height: 12),
              TextFormField(
                controller: _instrumentNameController,
                decoration: const InputDecoration(
                  labelText: '樂器名稱（可留空，例如先只建分部）',
                  border: OutlineInputBorder(),
                ),
                onChanged: (_) => setState(() {}),
              ),
              if (filteredInstrumentTags.isNotEmpty) ...[
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    '已有樂器標籤：',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
                const SizedBox(height: 4),
                Wrap(
                  spacing: 4,
                  children: [
                    for (final tag in filteredInstrumentTags)
                      InputChip(
                        label: Text(tag),
                        onPressed: () {
                          setState(() {
                            _instrumentNameController.text = tag;
                          });
                        },
                      ),
                  ],
                ),
              ],
              const SizedBox(height: 12),
              TextFormField(
                controller: _instrumentRemarkController,
                decoration: const InputDecoration(
                  labelText: '樂器備註（可留空，例如換槌、特殊技巧）',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _submitting ? null : _submit,
                  icon: _submitting
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.check),
                  label: Text(_submitting ? '送出中…' : '送出'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}




