import 'package:flutter/foundation.dart';

import '../../../data/datasources/google_sheets_piece_remote_data_source.dart';
import '../../../domain/entities/instrument.dart';
import '../../../domain/entities/part.dart';
import '../../../domain/entities/performance.dart';
import '../../../domain/entities/score_piece.dart';

/// 管理所有「表演」與其底下的曲目／樂器設定。
class PieceListProvider extends ChangeNotifier {
  final List<Performance> _performances = [];
  bool _isLoading = false;
  String? _errorMessage;

  final GoogleSheetsPieceRemoteDataSource _remoteDataSource =
      GoogleSheetsPieceRemoteDataSource();

  List<Performance> get performances => List.unmodifiable(_performances);
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;

  PieceListProvider() {
    // 啟動時自動從 Google 試算表載入資料
    loadFromRemote();
  }

  Future<void> loadFromRemote() async {
    print('DEBUG: loadFromRemote started');
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final remotePerformances = await _remoteDataSource.fetchPerformances();
      print('DEBUG: loadFromRemote success, got ${remotePerformances.length} performances');
      _performances
        ..clear()
        ..addAll(remotePerformances);
    } catch (e) {
      print('DEBUG: loadFromRemote error: $e');
      _errorMessage = '載入 Google 表單資料失敗：$e';

      // 若遠端讀取失敗且目前沒有任何資料，就塞一筆 demo 讓畫面不會是全空白
      if (_performances.isEmpty) {
        print('DEBUG: loadFromRemote using demo data due to error');
        _seedDemoData();
      }
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  void _seedDemoData() {
    final part1 = Part(id: 'p1', name: 'Percussion 1', order: 1);
    final part2 = Part(id: 'p2', name: 'Percussion 2', order: 2);
    final timpani = Part(id: 't1', name: 'Timpani', order: 3);

    final snare = Instrument(id: 'i1', name: 'Snare Drum');
    final bass = Instrument(id: 'i2', name: 'Bass Drum');
    final cymbal = Instrument(id: 'i3', name: 'Cymbal');
    final glock = Instrument(id: 'i4', name: 'Glockenspiel');

    final demoPiece = ScorePiece(
      id: 'piece1',
      title: 'Demo Piece 1',
      composer: 'Composer A',
      parts: [part1, part2, timpani],
      instrumentsByPart: {
        part1.id: [snare, glock],
        part2.id: [bass, cymbal],
        timpani.id: [],
      },
    );

    _performances
      ..clear()
      ..add(
        Performance(
          id: 'perf1',
          name: '示範表演',
          pieces: [demoPiece],
        ),
      );
  }

  /// 透過遠端 API 新增一列「表演 + 曲目 + 分部 + 樂器」資料，成功後重新載入清單
  Future<void> createPieceRowAndReload({
    required String performanceName,
    String? pieceId,
    required String title,
    String? composer,
    String? arranger,
    required String partName,
    String? instrumentName,
    String? instrumentRemark,
  }) async {
    print('DEBUG: createPieceRowAndReload started');
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      await _remoteDataSource.createPieceRow(
        performanceName: performanceName,
        pieceId: pieceId,
        title: title,
        composer: composer,
        arranger: arranger,
        partName: partName,
        instrumentName: instrumentName,
        instrumentRemark: instrumentRemark,
      );

      print('DEBUG: createPieceRowAndReload success, reloading all data');
      // 新增成功後，重新抓一次全部資料，確保與試算表內容一致
      await loadFromRemote();
    } catch (e) {
      print('DEBUG: createPieceRowAndReload error: $e');
      _errorMessage = '新增樂譜資料失敗：$e';
      _isLoading = false;
      notifyListeners();
      rethrow;
    }
  }

  Future<void> updatePieceRowAndReload({
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
    print('DEBUG: updatePieceRowAndReload started');
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      await _remoteDataSource.updatePieceRow(
        rowIndex: rowIndex,
        performanceName: performanceName,
        pieceId: pieceId,
        title: title,
        composer: composer,
        arranger: arranger,
        partName: partName,
        instrumentName: instrumentName,
        instrumentRemark: instrumentRemark,
      );

      print('DEBUG: updatePieceRowAndReload success, reloading all data');
      await loadFromRemote();
    } catch (e) {
      print('DEBUG: updatePieceRowAndReload error: $e');
      _errorMessage = '更新樂譜資料失敗：$e';
      _isLoading = false;
      notifyListeners();
      rethrow;
    }
  }

  Future<void> deletePieceRowAndReload({required int rowIndex}) async {
    print('DEBUG: deletePieceRowAndReload started for row $rowIndex');
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      await _remoteDataSource.deletePieceRow(rowIndex: rowIndex);

      print('DEBUG: deletePieceRowAndReload success, reloading all data');
      await loadFromRemote();
    } catch (e) {
      print('DEBUG: deletePieceRowAndReload error: $e');
      _errorMessage = '刪除樂譜資料失敗：$e';
      _isLoading = false;
      notifyListeners();
      rethrow;
    }
  }
}
