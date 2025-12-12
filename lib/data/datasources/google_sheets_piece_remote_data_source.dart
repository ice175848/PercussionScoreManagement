import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../domain/entities/performance.dart';
import '../../domain/entities/instrument.dart';
import '../../domain/entities/part.dart';
import '../../domain/entities/score_piece.dart';

/// 從 Google 表單對應的試算表讀取資料。
///
/// 建議你在 Google Sheet 上用 Apps Script 建立一個 Web App，
/// 讓這個 endpoint 回傳 JSON 陣列，每一列是以下欄位：
/// - performance_name  （表演名稱）
/// - piece_id
/// - title
/// - composer
/// - arranger
/// - part_name
/// - instrument_name
/// - instrument_remark
///
/// Flutter 這邊會把所有列 group 成 ScorePiece + Part + Instrument 結構。
class GoogleSheetsPieceRemoteDataSource {
  /// TODO: 請把這個 URL 換成你自己部署好的 Apps Script Web App URL。
  static const String _endpoint =
      'https://script.google.com/macros/s/AKfycbxeCbGZX1Bt0qYHBCmd5K7MdryrVI6x5mZOWMcHjxwu353e2Il6ctea9EZ3xkkuCQo/exec';

  final http.Client _client;

  GoogleSheetsPieceRemoteDataSource({http.Client? client})
      : _client = client ?? http.Client();

  /// 讀取全部資料並組成「表演 → 曲目 → 分部／樂器」結構。
  ///
  /// 試算表的每一列代表：
  /// 一場表演中的「某一首曲目」底下的「某個分部」使用的一個樂器。
  Future<List<Performance>> fetchPerformances() async {
    final uri = Uri.parse(_endpoint);
    print('DEBUG: fetchPerformances calling GET $uri');

    final response = await _client.get(uri);
    print('DEBUG: fetchPerformances response status: ${response.statusCode}');
    print('DEBUG: fetchPerformances response body: ${response.body}');

    if (response.statusCode != 200) {
      throw Exception('HTTP ${response.statusCode}');
    }

    final List<dynamic> jsonList = jsonDecode(response.body) as List<dynamic>;

    // 先按表演名稱 group，再在每個表演底下用 _PieceAccumulator 組成 ScorePiece。
    final Map<String, _PerformanceAccumulator> performanceMap = {};

    for (final row in jsonList) {
      if (row is! Map<String, dynamic>) continue;

      final rawPerformanceName = (row['performance_name'] ?? '').toString();
      final performanceName =
          rawPerformanceName.isEmpty ? '未命名表演' : rawPerformanceName;

      final pieceId = (row['piece_id'] ?? '').toString();
      final title = (row['title'] ?? '').toString();
      if (title.isEmpty) continue;

      final composer = (row['composer'] ?? '').toString();
      final arranger = (row['arranger'] ?? '').toString();
      final partName = (row['part_name'] ?? '').toString();
      final instrumentName = (row['instrument_name'] ?? '').toString();
      final instrumentRemark = (row['instrument_remark'] ?? '').toString();
      // 解析 _row 欄位
      final rowIndexVal = row['_row'];
      final int? rowIndex = (rowIndexVal is int)
          ? rowIndexVal
          : (rowIndexVal is String ? int.tryParse(rowIndexVal) : null);

      final effectivePieceId = pieceId.isEmpty ? title : pieceId;

      final perfAcc = performanceMap.putIfAbsent(
        performanceName,
        () => _PerformanceAccumulator(
          id: performanceName,
          name: performanceName,
        ),
      );

      perfAcc.addRow(
        pieceId: effectivePieceId,
        title: title,
        composer: composer,
        arranger: arranger,
        partName: partName,
        instrumentName: instrumentName,
        instrumentRemark: instrumentRemark,
        rowIndex: rowIndex,
      );
    }

    return performanceMap.values.map((e) => e.toPerformance()).toList();
  }

  /// （保留）只回傳所有曲目清單，不分表演。
  /// 讀取全部樂譜資料（GET）
  Future<List<ScorePiece>> fetchPieces() async {
    final uri = Uri.parse(_endpoint);
    final response = await _client.get(uri);

    if (response.statusCode != 200) {
      throw Exception('HTTP ${response.statusCode}');
    }

    final List<dynamic> jsonList = jsonDecode(response.body) as List<dynamic>;

    // 先把平面資料 group 成曲目 → 分部 → 樂器
    final Map<String, _PieceAccumulator> pieceMap = {};

    for (final row in jsonList) {
      if (row is! Map<String, dynamic>) continue;

      final pieceId = (row['piece_id'] ?? '').toString();
      final title = (row['title'] ?? '').toString();
      if (title.isEmpty) continue;

      final composer = (row['composer'] ?? '').toString();
      final arranger = (row['arranger'] ?? '').toString();
      final partName = (row['part_name'] ?? '').toString();
      final instrumentName = (row['instrument_name'] ?? '').toString();
      final instrumentRemark = (row['instrument_remark'] ?? '').toString();

      final effectivePieceId = pieceId.isEmpty ? title : pieceId;

      final pieceAcc = pieceMap.putIfAbsent(
        effectivePieceId,
        () => _PieceAccumulator(
          id: effectivePieceId,
          title: title,
          composer: composer.isEmpty ? null : composer,
          arranger: arranger.isEmpty ? null : arranger,
        ),
      );

      if (partName.isEmpty) continue;

      pieceAcc.addRow(
        partName: partName,
        instrumentName: instrumentName,
        instrumentRemark:
            instrumentRemark.isEmpty ? null : instrumentRemark,
      );
    }

    return pieceMap.values.map((e) => e.toScorePiece()).toList();
  }

  /// 新增一列樂譜資料（對應一個「曲目 + 分部 + 樂器」）
  ///
  /// 對 Apps Script 的 doPost() 傳送 JSON：
  /// {
  ///   "piece_id": "...",          // 可選
  ///   "title": "...",             // 必填
  ///   "composer": "...",          // 可選
  ///   "arranger": "...",          // 可選
  ///   "performance_name": "...",  // 必填：表演名稱
  ///   "part_name": "...",         // 必填
  ///   "instrument_name": "...",   // 可選（允許只有分部但暫時不填樂器）
  ///   "instrument_remark": "..."  // 可選
  /// }
  Future<void> createPieceRow({
    required String performanceName,
    String? pieceId,
    required String title,
    String? composer,
    String? arranger,
    required String partName,
    String? instrumentName,
    String? instrumentRemark,
  }) async {
    final uri = Uri.parse(_endpoint);
    final body = <String, dynamic>{
      'piece_id': pieceId ?? '',
      'performance_name': performanceName,
      'title': title,
      'composer': composer ?? '',
      'arranger': arranger ?? '',
      'part_name': partName,
      'instrument_name': instrumentName ?? '',
      'instrument_remark': instrumentRemark ?? '',
    };
    final jsonBody = jsonEncode(body);
    print('DEBUG: createPieceRow calling POST $uri');
    print('DEBUG: createPieceRow body: $jsonBody');

    var response = await _client.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonBody,
    );

    print('DEBUG: createPieceRow response status: ${response.statusCode}');
    print('DEBUG: createPieceRow response body: ${response.body}');

    // Google Apps Script 有時會回傳 302 Found，代表成功並轉址到回應內容
    if (response.statusCode == 302) {
      final location = response.headers['location'];
      if (location != null) {
        print('DEBUG: Following redirect to $location');
        response = await _client.get(Uri.parse(location));
        print('DEBUG: Redirect response status: ${response.statusCode}');
        print('DEBUG: Redirect response body: ${response.body}');
      }
    }

    if (response.statusCode != 200) {
      throw Exception('建立樂譜資料失敗：HTTP ${response.statusCode}');
    }

    // 可以視需要檢查回傳 JSON，例如 { "success": true }
  }

  Future<void> deletePieceRow({required int rowIndex}) async {
    final uri = Uri.parse(_endpoint);
    final body = <String, dynamic>{
      'action': 'delete',
      'row_index': rowIndex.toString(),
    };
    final jsonBody = jsonEncode(body);
    print('DEBUG: deletePieceRow calling POST $uri');
    print('DEBUG: deletePieceRow body: $jsonBody');

    var response = await _client.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonBody,
    );
    
    // Follow redirect if needed
    if (response.statusCode == 302) {
      final location = response.headers['location'];
      if (location != null) {
        response = await _client.get(Uri.parse(location));
      }
    }

    print('DEBUG: deletePieceRow response status: ${response.statusCode}');
    if (response.statusCode != 200) {
      throw Exception('刪除樂譜資料失敗：HTTP ${response.statusCode}');
    }
  }

  Future<void> updatePieceRow({
    required int rowIndex,
    required String performanceName,
    String? pieceId,
    required String title,
    String? composer,
    String? arranger,
    required String partName,
    String? instrumentName,
    String? instrumentRemark,
  }) async {
    final uri = Uri.parse(_endpoint);
    final body = <String, dynamic>{
      'action': 'update',
      'row_index': rowIndex.toString(),
      'piece_id': pieceId ?? '',
      'performance_name': performanceName,
      'title': title,
      'composer': composer ?? '',
      'arranger': arranger ?? '',
      'part_name': partName,
      'instrument_name': instrumentName ?? '',
      'instrument_remark': instrumentRemark ?? '',
    };
    final jsonBody = jsonEncode(body);
    print('DEBUG: updatePieceRow calling POST $uri');
    print('DEBUG: updatePieceRow body: $jsonBody');

    var response = await _client.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonBody,
    );
    
    // Follow redirect if needed
    if (response.statusCode == 302) {
      final location = response.headers['location'];
      if (location != null) {
        response = await _client.get(Uri.parse(location));
      }
    }

    print('DEBUG: updatePieceRow response status: ${response.statusCode}');
    if (response.statusCode != 200) {
      throw Exception('更新樂譜資料失敗：HTTP ${response.statusCode}');
    }
  }
}

class _PieceAccumulator {
  final String id;
  final String title;
  final String? composer;
  final String? arranger;

  final Map<String, Part> _partsByName = {};
  final Map<String, List<Instrument>> _instrumentsByPartId = {};

  int _partOrderCounter = 0;

  _PieceAccumulator({
    required this.id,
    required this.title,
    this.composer,
    this.arranger,
  });

  void addRow({
    required String partName,
    required String instrumentName,
    String? instrumentRemark,
    int? rowIndex,
  }) {
    final part = _partsByName.putIfAbsent(
      partName,
      () {
        _partOrderCounter += 1;
        final partId = '${id}_part_$_partOrderCounter';
        final part = Part(
          id: partId,
          name: partName,
          order: _partOrderCounter,
        );
        _instrumentsByPartId.putIfAbsent(partId, () => []);
        return part;
      },
    );

    if (instrumentName.isEmpty) {
      // 允許只有分部沒有樂器的情況
      return;
    }

    final instruments = _instrumentsByPartId.putIfAbsent(part.id, () => []);
    instruments.add(
      Instrument(
        id: '${part.id}_${instruments.length + 1}',
        name: instrumentName,
        remark: instrumentRemark,
        rowIndex: rowIndex,
      ),
    );
  }

  ScorePiece toScorePiece() {
    final parts = _partsByName.values.toList()
      ..sort((a, b) => a.order.compareTo(b.order));

    return ScorePiece(
      id: id,
      title: title,
      composer: composer,
      arranger: arranger,
      parts: parts,
      instrumentsByPart: Map.unmodifiable(_instrumentsByPartId),
    );
  }
}

class _PerformanceAccumulator {
  final String id;
  final String name;

  final Map<String, _PieceAccumulator> _piecesById = {};

  _PerformanceAccumulator({
    required this.id,
    required this.name,
  });

  void addRow({
    required String pieceId,
    required String title,
    required String composer,
    required String arranger,
    required String partName,
    required String instrumentName,
    required String instrumentRemark,
    int? rowIndex,
  }) {
    final pieceAcc = _piecesById.putIfAbsent(
      pieceId,
      () => _PieceAccumulator(
        id: pieceId,
        title: title,
        composer: composer.isEmpty ? null : composer,
        arranger: arranger.isEmpty ? null : arranger,
      ),
    );

    if (partName.isEmpty) {
      return;
    }

    pieceAcc.addRow(
      partName: partName,
      instrumentName: instrumentName,
      instrumentRemark:
          instrumentRemark.isEmpty ? null : instrumentRemark,
      rowIndex: rowIndex,
    );
  }

  Performance toPerformance() {
    final pieces = _piecesById.values.map((e) => e.toScorePiece()).toList();
    return Performance(
      id: id,
      name: name,
      pieces: pieces,
    );
  }
}


