import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../widgets/piece_card.dart';
import '../providers/piece_list_provider.dart';

class PieceListPage extends StatelessWidget {
  const PieceListPage({super.key});

  @override
  Widget build(BuildContext context) {
    final pieces = context.watch<PieceListProvider>().pieces;

    return Scaffold(
      appBar: AppBar(
        title: const Text('樂曲清單'),
      ),
      body: ListView.builder(
        itemCount: pieces.length,
        itemBuilder: (context, index) {
          final piece = pieces[index];
          return PieceCard(piece: piece);
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          // 之後可導向到「新增曲目」頁面
        },
        child: const Icon(Icons.add),
      ),
    );
  }
}



