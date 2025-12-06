/// 分部實體：例如「Percussion 1」「Timpani」「Mallets」等
class Part {
  final String id;
  final String name;

  /// 此分部在整首曲子中的排序用（例如 Percussion 1 在最上面）
  final int order;

  const Part({
    required this.id,
    required this.name,
    required this.order,
  });
}



