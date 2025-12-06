import 'package:flutter/material.dart';

import '../../../domain/entities/instrument.dart';
import '../../../domain/entities/part.dart';

/// 編輯單一「分部」所使用的樂器
class PartInstrumentEditPage extends StatefulWidget {
  final Part part;
  final List<Instrument> initialInstruments;

  const PartInstrumentEditPage({
    super.key,
    required this.part,
    required this.initialInstruments,
  });

  @override
  State<PartInstrumentEditPage> createState() => _PartInstrumentEditPageState();
}

class _PartInstrumentEditPageState extends State<PartInstrumentEditPage> {
  late final TextEditingController _instrumentController;
  late List<Instrument> _instruments;

  @override
  void initState() {
    super.initState();
    _instrumentController = TextEditingController();
    _instruments = List.of(widget.initialInstruments);
  }

  @override
  void dispose() {
    _instrumentController.dispose();
    super.dispose();
  }

  void _addInstrument() {
    final name = _instrumentController.text.trim();
    if (name.isEmpty) return;

    setState(() {
      _instruments.add(
        Instrument(
          id: DateTime.now().millisecondsSinceEpoch.toString(),
          name: name,
        ),
      );
    });
    _instrumentController.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('編輯樂器 - ${widget.part.name}'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(12.0),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _instrumentController,
                    decoration: const InputDecoration(
                      labelText: '新增樂器名稱',
                      border: OutlineInputBorder(),
                    ),
                    onSubmitted: (_) => _addInstrument(),
                  ),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: _addInstrument,
                  child: const Text('加入'),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Expanded(
              child: ListView.builder(
                itemCount: _instruments.length,
                itemBuilder: (context, index) {
                  final inst = _instruments[index];
                  return ListTile(
                    title: Text(inst.name),
                    trailing: IconButton(
                      icon: const Icon(Icons.delete),
                      onPressed: () {
                        setState(() {
                          _instruments.removeAt(index);
                        });
                      },
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}



