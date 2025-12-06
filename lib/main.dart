import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'presentation/app/app_widget.dart';
import 'presentation/pieces/providers/piece_list_provider.dart';

void main() {
  // 之後如果要初始化本地資料庫（例如 Hive）可以在這裡做
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => PieceListProvider()),
      ],
      child: const AppWidget(),
    ),
  );
}



